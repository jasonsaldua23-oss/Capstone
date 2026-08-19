from django.db import migrations, models


def _next_sequence(value: int) -> str:
    return str(value).zfill(4)


def backfill_purchase_request_workflow(apps, schema_editor) -> None:
    Order = apps.get_model("core", "Order")
    OrderTimeline = apps.get_model("core", "OrderTimeline")

    timeline_map = {
        row.order_id: row
        for row in OrderTimeline.objects.all().only(
            "order_id",
            "confirmed_at",
            "delivered_at",
            "cancelled_at",
        )
    }

    request_counter_by_year: dict[int, int] = {}
    order_counter_by_year: dict[int, int] = {}

    for order in Order.objects.all().order_by("created_at", "id"):
        created_at = getattr(order, "created_at", None)
        year = int(getattr(created_at, "year", 0) or 0) or 2026
        request_counter_by_year.setdefault(year, 0)
        request_counter_by_year[year] += 1

        timeline = timeline_map.get(order.id)
        raw_status = str(getattr(order, "status", "") or "").strip().upper()

        request_status = "PENDING_APPROVAL"
        purchase_order_stage = None

        if raw_status in {"REJECTED"}:
            request_status = "REJECTED"
        elif raw_status in {"CANCELLED"}:
            request_status = "APPROVED" if getattr(timeline, "confirmed_at", None) else "CANCELLED"
            purchase_order_stage = "CANCELLED" if request_status == "APPROVED" else None
        elif raw_status in {"CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "RESCHEDULED"} or getattr(timeline, "confirmed_at", None):
            request_status = "APPROVED"
            if raw_status == "CONFIRMED":
                purchase_order_stage = "APPROVED"
            elif raw_status in {"PREPARING", "RESCHEDULED"}:
                purchase_order_stage = "PROCESSING"
            elif raw_status == "OUT_FOR_DELIVERY":
                purchase_order_stage = "OUT_FOR_DELIVERY"
            elif raw_status == "DELIVERED":
                purchase_order_stage = "DELIVERED"
            else:
                purchase_order_stage = "APPROVED"

        order.purchase_request_number = order.purchase_request_number or f"PR-{year}-{_next_sequence(request_counter_by_year[year])}"
        order.request_status = request_status

        if request_status == "APPROVED":
            order_counter_by_year.setdefault(year, 0)
            order_counter_by_year[year] += 1
            order.purchase_order_number = order.purchase_order_number or f"PO-{year}-{_next_sequence(order_counter_by_year[year])}"
            order.purchase_order_stage = order.purchase_order_stage or purchase_order_stage or "APPROVED"
            if getattr(timeline, "confirmed_at", None) and not getattr(order, "approved_at", None):
                order.approved_at = timeline.confirmed_at
        else:
            order.purchase_order_stage = None

        if request_status == "REJECTED" and getattr(timeline, "cancelled_at", None) and not getattr(order, "rejected_at", None):
            order.rejected_at = timeline.cancelled_at
        if request_status == "CANCELLED" and getattr(timeline, "cancelled_at", None) and not getattr(order, "cancelled_at", None):
            order.cancelled_at = timeline.cancelled_at
        if purchase_order_stage == "CANCELLED" and getattr(timeline, "cancelled_at", None) and not getattr(order, "cancelled_at", None):
            order.cancelled_at = timeline.cancelled_at

        order.save(
            update_fields=[
                "purchase_request_number",
                "purchase_order_number",
                "request_status",
                "purchase_order_stage",
                "approved_at",
                "rejected_at",
                "cancelled_at",
                "updated_at",
            ]
        )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0078_reconcile_sqlite_order_legacy_columns"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="approved_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="approved_by_name",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="approved_by_user_id",
            field=models.CharField(blank=True, max_length=25, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="cancelled_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="cancelled_by_name",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="cancelled_by_user_id",
            field=models.CharField(blank=True, max_length=25, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="cancellation_reason",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="purchase_order_number",
            field=models.CharField(blank=True, db_index=True, max_length=120, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="purchase_order_stage",
            field=models.CharField(
                blank=True,
                choices=[
                    ("APPROVED", "Approved"),
                    ("PROCESSING", "Processing"),
                    ("READY_FOR_DELIVERY", "Ready for Delivery"),
                    ("FOR_DELIVERY", "For Delivery"),
                    ("OUT_FOR_DELIVERY", "Out for Delivery"),
                    ("DELIVERED", "Delivered"),
                    ("COMPLETED", "Completed"),
                    ("CANCELLED", "Cancelled"),
                ],
                max_length=50,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="order",
            name="purchase_request_number",
            field=models.CharField(blank=True, db_index=True, max_length=120, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="rejected_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="rejected_by_name",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="rejected_by_user_id",
            field=models.CharField(blank=True, max_length=25, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="rejection_reason",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="request_status",
            field=models.CharField(
                choices=[
                    ("PENDING_APPROVAL", "Pending Approval"),
                    ("APPROVED", "Approved"),
                    ("REJECTED", "Rejected"),
                    ("CANCELLED", "Cancelled"),
                ],
                default="PENDING_APPROVAL",
                max_length=50,
            ),
        ),
        migrations.RunPython(backfill_purchase_request_workflow, migrations.RunPython.noop),
    ]
