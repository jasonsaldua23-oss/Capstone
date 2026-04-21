from django.db import migrations, models


def migrate_legacy_order_statuses(apps, schema_editor):
    Order = apps.get_model("core", "Order")
    Order.objects.filter(status="PROCESSING").update(status="PREPARING")
    Order.objects.filter(status="PACKED").update(status="PREPARING")
    Order.objects.filter(status="DISPATCHED").update(status="OUT_FOR_DELIVERY")
    Order.objects.filter(status="READY_FOR_PICKUP").update(status="PREPARING")
    Order.objects.filter(status="IN_TRANSIT").update(status="OUT_FOR_DELIVERY")
    Order.objects.filter(status="UNAPPROVED").update(status="PREPARING")
    Order.objects.filter(status="FAILED_DELIVERY").update(status="CANCELLED")


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0007_order_warehouse_stage_controls"),
    ]

    operations = [
        migrations.RunPython(migrate_legacy_order_statuses, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="order",
            name="status",
            field=models.CharField(
                choices=[
                    ("PENDING", "Pending"),
                    ("CONFIRMED", "Confirmed"),
                    ("PREPARING", "Preparing"),
                    ("OUT_FOR_DELIVERY", "Out For Delivery"),
                    ("DELIVERED", "Delivered"),
                    ("CANCELLED", "Cancelled"),
                ],
                default="PREPARING",
                max_length=50,
            ),
        ),
    ]
