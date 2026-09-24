from django.db import migrations, models
from django.utils import timezone


def _rename_status(apps, schema_editor, old: str, new: str) -> None:
    Order = apps.get_model("core", "Order")
    # Bump updated_at so delta-synced clients refetch the renamed rows.
    # Use the migration connection even when a database router is configured.
    Order.objects.using(schema_editor.connection.alias).filter(status=old).update(status=new, updated_at=timezone.now())


def confirmed_to_approved(apps, schema_editor):
    _rename_status(apps, schema_editor, "CONFIRMED", "APPROVED")


def approved_to_confirmed(apps, schema_editor):
    _rename_status(apps, schema_editor, "APPROVED", "CONFIRMED")


class Migration(migrations.Migration):
    dependencies = [("core", "0142_mark_direct_deletions")]

    operations = [
        migrations.AlterField(
            model_name="order",
            name="status",
            field=models.CharField(
                choices=[
                    ("PENDING", "Pending"),
                    ("APPROVED", "Approved"),
                    ("PREPARING", "Processing"),
                    ("RESCHEDULED", "Rescheduled"),
                    ("OUT_FOR_DELIVERY", "Out For Delivery"),
                    ("DELIVERED", "Delivered"),
                    ("REJECTED", "Rejected"),
                    ("CANCELLED", "Cancelled"),
                ],
                default="PENDING",
                max_length=50,
            ),
        ),
        migrations.RunPython(confirmed_to_approved, approved_to_confirmed),
    ]
