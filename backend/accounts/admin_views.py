from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Sum
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from rest_framework import generics, serializers, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.drf_permissions import HasAdminPermission, IsAdminUser
from accounts.models import AdminProfile, AdminRole, CustomerProfile, Permission, RolePermission, UserKind
from accounts.authentication import revoke_refresh_tokens
from accounts.permissions import PRIVILEGED_ROLES, is_super_admin, role_permissions, user_permissions, user_role
from accounts.serializers import run_password_validators
from audit.services import record_audit
from commerce.models import Order, PaymentStatus

User = get_user_model()


class AdminCustomerSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(source="user.email", read_only=True)
    name = serializers.CharField(source="user.first_name")
    disabled = serializers.BooleanField(source="user.disabled", read_only=True)

    class Meta:
        model = CustomerProfile
        fields = (
            "id",
            "email",
            "name",
            "phone",
            "status",
            "notes",
            "locale",
            "disabled",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at", "email", "disabled")


class AdminCustomerDetailSerializer(AdminCustomerSerializer):
    orders_count = serializers.SerializerMethodField()
    total_spent_fils = serializers.SerializerMethodField()
    recent_orders = serializers.SerializerMethodField()

    class Meta(AdminCustomerSerializer.Meta):
        fields = AdminCustomerSerializer.Meta.fields + (
            "orders_count",
            "total_spent_fils",
            "recent_orders",
        )

    def get_orders_count(self, obj):
        return Order.objects.filter(user=obj.user).count()

    def get_total_spent_fils(self, obj):
        return (
            Order.objects.filter(user=obj.user, payment_status=PaymentStatus.PAID).aggregate(
                total=Coalesce(Sum("total_fils"), 0)
            )["total"]
            or 0
        )

    def get_recent_orders(self, obj):
        orders = Order.objects.filter(user=obj.user).order_by("-created_at")[:10]
        return [
            {
                "id": o.id,
                "order_number": o.order_number,
                "total_fils": o.total_fils,
                "payment_status": o.payment_status,
                "fulfillment_status": o.fulfillment_status,
                "created_at": o.created_at,
            }
            for o in orders
        ]


class AdminCustomerPatchSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerProfile
        fields = ("phone", "status", "notes")


class CustomerListView(generics.ListAPIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "customers.read"
    serializer_class = AdminCustomerSerializer
    queryset = CustomerProfile.objects.select_related("user").order_by("-created_at")
    search_fields = ["user__email", "user__first_name", "phone"]
    filterset_fields = ["status"]


class CustomerDetailView(generics.RetrieveUpdateAPIView):
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

    def perform_update(self, serializer):
        serializer.save()
        record_audit(
            self.request.user,
            "customer.updated",
            entity_type="CustomerProfile",
            entity_id=serializer.instance.pk,
            meta={"fields": sorted(serializer.validated_data.keys())},
        )


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
    return bool(user.is_superuser or user_role(user) in PRIVILEGED_ROLES)


def _other_active_super_admins(user) -> int:
    return (
        AdminProfile.objects.filter(role=AdminRole.SUPER_ADMIN, user__disabled=False, user__is_active=True)
        .exclude(user=user)
        .count()
    )


class AdminUserSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
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
            "title",
            "permissions",
            "date_joined",
            "last_login",
        )
        read_only_fields = fields

    def get_role(self, obj):
        role = user_role(obj)
        if role is None and obj.is_superuser:
            return AdminRole.SUPER_ADMIN
        return role

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
        return Response(AdminUserSerializer(self.get_queryset(), many=True).data)

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
        record_audit(
            request.user,
            "admin.created",
            entity_type="User",
            entity_id=user.pk,
            meta={"email": user.email, "role": role},
        )
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
        current_role = user_role(target) or (AdminRole.SUPER_ADMIN if target.is_superuser else None)

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
                changes["role"] = {"from": current_role, "to": data["role"]}
                profile.role = data["role"]
                profile_fields.append("role")
            if "title" in data and data["title"] != profile.title:
                profile.title = data["title"]
                profile_fields.append("title")
                changes["title"] = True
            if profile_fields:
                profile.save(update_fields=profile_fields + ["updated_at"])
            if (disabled_changed and target.disabled) or "password" in data:
                revoke_refresh_tokens(target)

        if changes:
            record_audit(actor, "admin.updated", entity_type="User", entity_id=target.pk, meta=changes)
        if disabled_changed:
            record_audit(
                actor,
                "admin.disabled" if target.disabled else "admin.enabled",
                entity_type="User",
                entity_id=target.pk,
                meta={"email": target.email},
            )
        if "password" in data:
            record_audit(
                actor, "admin.password_reset", entity_type="User", entity_id=target.pk, meta={"email": target.email}
            )
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
            meta={"role": role, "added": sorted(set(wanted) - before), "removed": sorted(before - set(wanted))},
        )
        return Response({"role": role, "permissions": wanted})
