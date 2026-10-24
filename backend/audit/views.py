from __future__ import annotations

from django.db.models import Q, TextField
from django.db.models.functions import Cast
from django_filters import rest_framework as filters
from rest_framework import generics, serializers
from rest_framework.filters import OrderingFilter

from accounts.drf_permissions import HasAdminPermission, IsAdminUser
from audit.models import AuditLog
from audit.services import actor_label, entity_label


class AuditLogSerializer(serializers.ModelSerializer):
    actor_email = serializers.EmailField(source="actor.email", read_only=True, allow_null=True)
    actor_name = serializers.SerializerMethodField()
    entity_label = serializers.SerializerMethodField()
    order_number = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = (
            "id",
            "actor",
            "actor_email",
            "actor_name",
            "action",
            "entity_type",
            "entity_id",
            "entity_label",
            "order_number",
            "meta",
            "created_at",
        )

    def get_actor_name(self, obj) -> str:
        return actor_label(obj)

    def get_entity_label(self, obj) -> str:
        return entity_label(obj)

    def get_order_number(self, obj):
        return (obj.meta or {}).get("order_number") or None


class AuditLogFilter(filters.FilterSet):
    action = filters.CharFilter()
    action_prefix = filters.CharFilter(field_name="action", lookup_expr="startswith")
    entity_type = filters.CharFilter()
    entity_id = filters.CharFilter()
    actor = filters.NumberFilter(field_name="actor_id")
    order_number = filters.CharFilter(method="filter_order_number")
    date_from = filters.IsoDateTimeFilter(field_name="created_at", lookup_expr="gte")
    date_to = filters.IsoDateTimeFilter(field_name="created_at", lookup_expr="lte")
    search = filters.CharFilter(method="filter_search")

    class Meta:
        model = AuditLog
        fields = ["action", "entity_type", "actor"]

    def filter_order_number(self, queryset, name, value):
        value = (value or "").strip()
        return queryset.filter(meta__order_number__iexact=value) if value else queryset

    def filter_search(self, queryset, name, value):
        """Searches action, entity, actor e-mail and every metadata value (order numbers, e-mails, codes)."""
        value = (value or "").strip()
        if not value:
            return queryset
        return queryset.annotate(_meta_text=Cast("meta", TextField())).filter(
            Q(action__icontains=value)
            | Q(entity_type__icontains=value)
            | Q(entity_id=value)
            | Q(actor__email__icontains=value)
            | Q(_meta_text__icontains=value)
        )


class AdminAuditListView(generics.ListAPIView):
    """GET admin/audit/?search=&order_number=&action=&action_prefix=&entity_type=&entity_id=&actor=&date_from=&date_to="""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "audit.read"
    serializer_class = AuditLogSerializer
    filterset_class = AuditLogFilter
    filter_backends = [filters.DjangoFilterBackend, OrderingFilter]
    ordering_fields = ["created_at", "action"]
    ordering = ["-created_at"]
    queryset = AuditLog.objects.select_related("actor")
