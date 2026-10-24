from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import generics, serializers, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.authentication import bump_token_version, revoke_all_sessions
from accounts.customer_stats import customer_order_stats, customer_orders_queryset
from accounts.drf_permissions import HasAdminPermission, IsAdminUser
from accounts.models import AdminProfile, AdminRole, CustomerProfile, Permission, RolePermission, UserKind
from accounts.permissions import (
    PRIVILEGED_ROLES,
    effective_role,
    effective_super_admins_qs,
    is_super_admin,
    role_label,
    role_permissions,
    user_permissions,
)
from accounts.serializers import run_password_validators, validate_phone_value
from audit.services import record_audit

User = get_user_model()


class AdminCustomerSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(source="user.email", read_only=True)
    name = serializers.CharField(source="user.first_name")
    disabled = serializers.BooleanField(source="user.disabled", read_only=True)
    orders_count = serializers.SerializerMethodField()
    guest_orders_count = serializers.SerializerMethodField()
    total_spent_fils = serializers.SerializerMethodField()

    class Meta:
        model = CustomerProfile
        fields = (
            "id",
            "user_id",
            "email",
            "name",
            "phone",
            "status",
            "notes",
            "locale",
            "disabled",
            "orders_count",
            "guest_orders_count",
            "total_spent_fils",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at", "email", "disabled", "user_id")

    def _stats(self, obj) -> dict:
        cache = self.context.setdefault("customer_stats", {})
        if obj.user_id not in cache:
            cache.update(customer_order_stats([obj.user]))
        return cache.get(obj.user_id) or {}

    def get_orders_count(self, obj) -> int:
        return int(self._stats(obj).get("orders_count", 0))

    def get_guest_orders_count(self, obj) -> int:
        return int(self._stats(obj).get("guest_orders_count", 0))

    def get_total_spent_fils(self, obj) -> int:
        return int(self._stats(obj).get("total_spent_fils", 0))


class AdminCustomerDetailSerializer(AdminCustomerSerializer):
    recent_orders = serializers.SerializerMethodField()

    class Meta(AdminCustomerSerializer.Meta):
        fields = AdminCustomerSerializer.Meta.fields + ("recent_orders",)

    def get_recent_orders(self, obj):
        orders = customer_orders_queryset(obj.user).order_by("-created_at")[:20]
        return [
            {
                "id": o.id,
                "order_number": o.order_number,
                "email": o.email,
                "total_fils": o.total_fils,
                "payment_status": o.payment_status,
                "fulfillment_status": o.fulfillment_status,
                "created_at": o.created_at,
                # Guest checkout with the same email (not linked to the account).
                "is_guest": o.user_id is None,
            }
            for o in orders
        ]


class AdminCustomerPatchSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="user.first_name", required=False, max_length=150)
    disabled = serializers.BooleanField(source="user.disabled", required=False)

    class Meta:
        model = CustomerProfile
        fields = ("phone", "status", "notes", "name", "disabled")

    def validate_phone(self, value):
        return validate_phone_value(value)


class CustomerListView(generics.ListAPIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "customers.read"
    serializer_class = AdminCustomerSerializer
    queryset = CustomerProfile.objects.select_related("user").order_by("-created_at")
    search_fields = ["user__email", "user__first_name", "user__last_name", "phone"]
    filterset_fields = ["status"]

    def get_queryset(self):
        qs = super().get_queryset()
        disabled = (self.request.query_params.get("disabled") or "").lower()
        if disabled in {"true", "1", "yes"}:
            qs = qs.filter(user__disabled=True)
        elif disabled in {"false", "0", "no"}:
            qs = qs.filter(user__disabled=False)
        return qs

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        rows = page if page is not None else list(queryset)
        context = self.get_serializer_context()
        context["customer_stats"] = customer_order_stats([p.user for p in rows])
        data = self.get_serializer_class()(rows, many=True, context=context).data
        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)


class CustomerDetailView(generics.RetrieveUpdateAPIView):
    """GET detail (+ guest orders by email); PATCH ``{phone?, status?, notes?, name?, disabled?}``.

    Disabling a customer blocks login (403 ``account_disabled``), kills every session
    (access + refresh tokens) and blocks checkout.
    """

    permission_classes = [IsAdminUser, HasAdminPermission]
    queryset = CustomerProfile.objects.select_related("user")
    http_method_names = ["get", "patch", "head", "options"]

    def get_permissions(self):
        self.admin_permission = "customers.read" if self.request.method == "GET" else "customers.write"
        return super().get_permissions()

    def get_serializer_class(self):
        if self.request.method == "PATCH":
            return AdminCustomerPatchSerializer
        return AdminCustomerDetailSerializer

    def update(self, request, *args, **kwargs):
        profile = self.get_object()
        serializer = AdminCustomerPatchSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        user_data = data.pop("user", {}) or {}
        user = profile.user
        was_disabled = user.disabled
        with transaction.atomic():
            for attr, value in data.items():
                setattr(profile, attr, value)
            if data:
                profile.save()
            user_fields = []
            if "first_name" in user_data and user_data["first_name"] != user.first_name:
                user.first_name = user_data["first_name"]
                user_fields.append("first_name")
            if "disabled" in user_data and user_data["disabled"] != user.disabled:
                user.disabled = user_data["disabled"]
                user_fields.append("disabled")
            if user_fields:
                user.save(update_fields=user_fields)
            if user.disabled and not was_disabled:
                revoke_all_sessions(user)
        fields = sorted(set(data) | {("name" if k == "first_name" else k) for k in user_data})
        if fields:
            record_audit(
                request.user,
                "customer.updated",
                entity_type="CustomerProfile",
                entity_id=profile.pk,
                meta={"fields": fields, "email": user.email, "name": user.get_full_name()},
            )
        if user.disabled != was_disabled:
            record_audit(
                request.user,
                "customer.disabled" if user.disabled else "customer.enabled",
                entity_type="User",
                entity_id=user.pk,
                meta={"email": user.email, "name": user.get_full_name(), "customer_id": profile.pk},
            )
        profile = self.get_queryset().get(pk=profile.pk)
        return Response(AdminCustomerDetailSerializer(profile, context=self.get_serializer_context()).data)


# ---------------------------------------------------------------------------
# Administrators & roles
#
# Escalation rules:
#   * Only a SUPER_ADMIN (role or is_superuser) may create, edit, disable, or reset the
#     password of an ADMIN / SUPER_ADMIN account, or assign/remove those roles.
#   * Any actor with ``admins.write`` may manage accounts whose role is below ADMIN and
#     assign roles below ADMIN.
#   * Nobody can change their own role or disable themselves.
#   * The last active SUPER_ADMIN cannot be demoted or disabled.
#   * Only a SUPER_ADMIN may edit role permissions; SUPER_ADMIN permissions are fixed.
# ---------------------------------------------------------------------------


def _is_privileged_target(user) -> bool:
    return effective_role(user) in PRIVILEGED_ROLES


def _other_active_super_admins(user) -> int:
    """Effective SUPER_ADMINs (role, or superuser without a profile) other than ``user``."""
    return effective_super_admins_qs().exclude(pk=user.pk).count()


def _target_meta(user) -> dict:
    role = effective_role(user)
    return {"email": user.email, "name": user.get_full_name(), "role": role, "role_label": role_label(role)}


class AdminUserSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    role_label = serializers.SerializerMethodField()
    title = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "first_name",
            "last_name",
            "kind",
            "disabled",
            "role",
            "role_label",
            "title",
            "permissions",
            "date_joined",
            "last_login",
        )
        read_only_fields = fields

    def get_role(self, obj):
        return effective_role(obj)

    def get_role_label(self, obj):
        return role_label(effective_role(obj))

    def get_title(self, obj):
        profile = getattr(obj, "admin_profile", None)
        return profile.title if profile else ""

    def get_permissions(self, obj):
        return sorted(user_permissions(obj))


class CreateAdminSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(min_length=12, write_only=True, trim_whitespace=False)
    full_name = serializers.CharField(max_length=160)
    role = serializers.ChoiceField(choices=AdminRole.choices)
    title = serializers.CharField(max_length=120, required=False, allow_blank=True)

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Email already registered")
        return value

    def validate(self, attrs):
        candidate = User(email=attrs.get("email", ""), first_name=attrs.get("full_name", ""))
        run_password_validators(attrs.get("password", ""), user=candidate)
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        user = User.objects.create_user(
            email=validated_data["email"],
            password=validated_data["password"],
            first_name=validated_data["full_name"],
            kind=UserKind.ADMIN,
            is_staff=True,
            # D14: is_superuser mirrors the SUPER_ADMIN role.
            is_superuser=validated_data["role"] == AdminRole.SUPER_ADMIN,
        )
        AdminProfile.objects.create(
            user=user,
            role=validated_data["role"],
            title=validated_data.get("title", ""),
        )
        return user


class UpdateAdminSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=AdminRole.choices, required=False)
    title = serializers.CharField(max_length=120, required=False, allow_blank=True)
    disabled = serializers.BooleanField(required=False)
    full_name = serializers.CharField(max_length=160, required=False)
    password = serializers.CharField(write_only=True, required=False, trim_whitespace=False, min_length=12)


class AdministratorViewSet(viewsets.ViewSet):
    permission_classes = [IsAdminUser, HasAdminPermission]

    def get_permissions(self):
        if self.action in {"list", "retrieve"}:
            self.admin_permission = "admins.read"
        else:
            self.admin_permission = "admins.write"
        return super().get_permissions()

    def get_queryset(self):
        return (
            User.objects.filter(kind=UserKind.ADMIN)
            .select_related("admin_profile")
            .order_by("email")
        )

    def list(self, request):
        """``?search=`` (email / first / last name), ``?role=``, ``?disabled=true|false``.

        Plain array by default; paginated ``{count, next, previous, results}`` when ``page``
        or ``page_size`` is supplied (RO-08).
        """
        qs = self.get_queryset()
        term = (request.query_params.get("search") or request.query_params.get("q") or "").strip()
        if term:
            qs = qs.filter(Q(email__icontains=term) | Q(first_name__icontains=term) | Q(last_name__icontains=term))
        role = (request.query_params.get("role") or "").strip().upper()
        if role:
            if role == AdminRole.SUPER_ADMIN:
                qs = qs.filter(Q(admin_profile__role=role) | Q(is_superuser=True, admin_profile__isnull=True))
            else:
                qs = qs.filter(admin_profile__role=role)
        disabled = (request.query_params.get("disabled") or "").lower()
        if disabled in {"true", "1", "yes"}:
            qs = qs.filter(disabled=True)
        elif disabled in {"false", "0", "no"}:
            qs = qs.filter(disabled=False)
        if "page" in request.query_params or "page_size" in request.query_params:
            from config.pagination import BoundedPageNumberPagination

            paginator = BoundedPageNumberPagination()
            page = paginator.paginate_queryset(qs, request, view=self)
            return paginator.get_paginated_response(AdminUserSerializer(page, many=True).data)
        return Response(AdminUserSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        user = get_object_or_404(self.get_queryset(), pk=pk)
        return Response(AdminUserSerializer(user).data)

    def create(self, request):
        serializer = CreateAdminSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        role = serializer.validated_data["role"]
        if role in PRIVILEGED_ROLES and not is_super_admin(request.user):
            return Response(
                {"detail": "Only a SUPER_ADMIN can create ADMIN or SUPER_ADMIN accounts", "code": "forbidden_role"},
                status=status.HTTP_403_FORBIDDEN,
            )
        user = serializer.save()
        record_audit(request.user, "admin.created", entity_type="User", entity_id=user.pk, meta=_target_meta(user))
        return Response(AdminUserSerializer(user).data, status=status.HTTP_201_CREATED)

    def update(self, request, pk=None):
        return self.partial_update(request, pk=pk)

    def partial_update(self, request, pk=None):
        target = get_object_or_404(self.get_queryset(), pk=pk)
        serializer = UpdateAdminSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        actor = request.user
        actor_is_super = is_super_admin(actor)
        is_self = target.pk == actor.pk
        current_role = effective_role(target)

        def forbidden(detail: str, code: str = "forbidden"):
            return Response({"detail": detail, "code": code}, status=status.HTTP_403_FORBIDDEN)

        def bad(field: str, message: str):
            return Response(
                {"detail": {field: [message]}, "code": "validation_error"}, status=status.HTTP_400_BAD_REQUEST
            )

        role_change = "role" in data and data["role"] != current_role
        if is_self and role_change:
            return bad("role", "You cannot change your own role")
        if is_self and data.get("disabled") is True and not target.disabled:
            return bad("disabled", "You cannot disable your own account")
        if not actor_is_super:
            if not is_self and _is_privileged_target(target):
                return forbidden("Only a SUPER_ADMIN can manage ADMIN or SUPER_ADMIN accounts", "forbidden_role")
            if role_change and data["role"] in PRIVILEGED_ROLES:
                return forbidden("Only a SUPER_ADMIN can assign the ADMIN or SUPER_ADMIN role", "forbidden_role")
        if current_role == AdminRole.SUPER_ADMIN and _other_active_super_admins(target) < 1:
            if role_change:
                return bad("role", "Cannot demote the last SUPER_ADMIN")
            if data.get("disabled") is True:
                return bad("disabled", "Cannot disable the last SUPER_ADMIN")
        if "password" in data:
            run_password_validators(data["password"], user=target)

        changes: dict = {}
        disabled_changed = "disabled" in data and data["disabled"] != target.disabled
        with transaction.atomic():
            profile, _ = AdminProfile.objects.get_or_create(
                user=target, defaults={"role": current_role or AdminRole.VIEWER}
            )
            user_fields: list[str] = []
            if "full_name" in data and data["full_name"] != target.first_name:
                target.first_name = data["full_name"]
                user_fields.append("first_name")
                changes["full_name"] = True
            if disabled_changed:
                target.disabled = data["disabled"]
                user_fields.append("disabled")
            if "password" in data:
                target.set_password(data["password"])
                user_fields.append("password")
            if user_fields:
                target.save(update_fields=user_fields)
            profile_fields: list[str] = []
            if role_change:
                changes["role"] = {
                    "from": current_role,
                    "to": data["role"],
                    "from_label": role_label(current_role),
                    "to_label": role_label(data["role"]),
                }
                profile.role = data["role"]
                profile_fields.append("role")
            if "title" in data and data["title"] != profile.title:
                profile.title = data["title"]
                profile_fields.append("title")
                changes["title"] = True
            if profile_fields:
                profile.save(update_fields=profile_fields + ["updated_at"])
            # D14: keep is_superuser in sync with the SUPER_ADMIN role.
            want_superuser = profile.role == AdminRole.SUPER_ADMIN
            if target.is_superuser != want_superuser:
                target.is_superuser = want_superuser
                target.save(update_fields=["is_superuser"])
            # D14: these invalidate existing access tokens immediately.
            if (disabled_changed and target.disabled) or "password" in data:
                revoke_all_sessions(target)
            elif role_change:
                bump_token_version(target)

        target_meta = {"email": target.email, "name": target.get_full_name()}
        if changes:
            record_audit(
                actor, "admin.updated", entity_type="User", entity_id=target.pk, meta={**target_meta, **changes}
            )
        if disabled_changed:
            record_audit(
                actor,
                "admin.disabled" if target.disabled else "admin.enabled",
                entity_type="User",
                entity_id=target.pk,
                meta=_target_meta(target),
            )
        if "password" in data:
            record_audit(actor, "admin.password_reset", entity_type="User", entity_id=target.pk, meta=_target_meta(target))
        target = self.get_queryset().get(pk=target.pk)
        return Response(AdminUserSerializer(target).data)


class RoleListView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "admins.read"

    def get(self, request):
        rows: dict[str, set[str]] = {}
        for role, key in RolePermission.objects.values_list("role", "permission__key"):
            rows.setdefault(role, set()).add(key)
        roles = []
        for role, label in AdminRole.choices:
            perms = ["*"] if role == AdminRole.SUPER_ADMIN else sorted(rows.get(role, set()))
            roles.append(
                {"role": role, "label": label, "permissions": perms, "editable": role != AdminRole.SUPER_ADMIN}
            )
        return Response(roles)


class PermissionListView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "admins.read"

    def get(self, request):
        perms = Permission.objects.order_by("key")
        return Response([{"key": p.key, "description": p.description} for p in perms])


class RolePermissionsUpdateView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "admins.write"

    def put(self, request, role: str):
        if role not in AdminRole.values:
            return Response({"detail": "Unknown role", "code": "validation_error"}, status=400)
        if not is_super_admin(request.user):
            return Response(
                {"detail": "Only a SUPER_ADMIN can edit role permissions", "code": "forbidden_role"}, status=403
            )
        if role == AdminRole.SUPER_ADMIN:
            return Response(
                {"detail": "SUPER_ADMIN permissions are fixed and cannot be edited", "code": "validation_error"},
                status=400,
            )
        keys = request.data.get("permissions")
        if not isinstance(keys, list) or not all(isinstance(k, str) for k in keys):
            return Response(
                {"detail": "permissions must be a list of permission keys", "code": "validation_error"}, status=400
            )
        wanted = sorted(set(keys))
        perms = {p.key: p for p in Permission.objects.filter(key__in=wanted)}
        unknown = [k for k in wanted if k not in perms]
        if unknown:
            return Response(
                {
                    "detail": f"Unknown permission(s): {', '.join(unknown)}",
                    "unknown": unknown,
                    "code": "validation_error",
                },
                status=400,
            )
        before = role_permissions(role)
        with transaction.atomic():
            RolePermission.objects.filter(role=role).delete()
            RolePermission.objects.bulk_create([RolePermission(role=role, permission=perms[k]) for k in wanted])
        record_audit(
            request.user,
            "role.permissions_updated",
            entity_type="Role",
            entity_id=role,
            meta={
                "role": role,
                "role_label": role_label(role),
                "added": sorted(set(wanted) - before),
                "removed": sorted(before - set(wanted)),
            },
        )
        return Response({"role": role, "permissions": wanted})
