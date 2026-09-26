from django.db import migrations
from django.utils import timezone

# Mirrors views_trips: an order on an open trip holds one of these drop-point states.
ACTIVE_DROP_POINT_STATUSES = ["PENDING", "ARRIVED", "IN_TRANSIT", "IN_PROGRESS"]
OPEN_TRIP_STATUSES = ["PLANNED", "IN_PROGRESS"]
AWAITING_PROCESSING_STATUSES = ["APPROVED", "RESCHEDULED"]


def start_processing_for_purchase_orders_on_trips(apps, schema_editor):
    """Repair POs that were put on a trip while still Approved.

    Trip assignment did not move a PO into Processing, so the Purchase Orders page
    offered "Start Processing" for orders already on a truck. Trip assignment now
    does that itself; this brings the orders already caught that way in line.
    """
    db = schema_editor.connection.alias
    Order = apps.get_model("core", "Order")
    OrderTimeline = apps.get_model("core", "OrderTimeline")
    TripDropPoint = apps.get_model("core", "TripDropPoint")

    on_open_trips = TripDropPoint.objects.using(db).filter(
        status__in=ACTIVE_DROP_POINT_STATUSES,
        trip__status__in=OPEN_TRIP_STATUSES,
        order_id__isnull=False,
    ).values_list("order_id", flat=True)
    order_ids = list(
        Order.objects.using(db)
        .filter(id__in=list(on_open_trips), status__in=AWAITING_PROCESSING_STATUSES)
        .exclude(purchase_order_number__isnull=True)
        .exclude(purchase_order_number="")
        .values_list("id", flat=True)
    )
    if not order_ids:
        return
    now = timezone.now()
    # Bump updated_at so delta-synced portals refetch the repaired rows.
    Order.objects.using(db).filter(id__in=order_ids).update(
        status="PREPARING", purchase_order_stage="PROCESSING", updated_at=now
    )
    OrderTimeline.objects.using(db).filter(order_id__in=order_ids, processed_at__isnull=True).update(processed_at=now)


class Migration(migrations.Migration):
    dependencies = [("core", "0144_merge_super_admin_into_admin")]

    operations = [
        migrations.RunPython(start_processing_for_purchase_orders_on_trips, migrations.RunPython.noop),
    ]
