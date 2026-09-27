from django.db import migrations, models
from django.utils import timezone


def _rename_status(apps, schema_editor, old: str, new: str) -> None:
    StockBatch = apps.get_model("core", "StockBatch")
    # Bump updated_at so delta-synced clients refetch the renamed rows.
    # Use the migration connection even when a database router is configured.
    StockBatch.objects.using(schema_editor.connection.alias).filter(status=old).update(
        status=new, updated_at=timezone.now()
    )


def active_to_healthy(apps, schema_editor):
    _rename_status(apps, schema_editor, "ACTIVE", "HEALTHY")


def healthy_to_active(apps, schema_editor):
    _rename_status(apps, schema_editor, "HEALTHY", "ACTIVE")


class Migration(migrations.Migration):
    dependencies = [("core", "0145_start_processing_for_purchase_orders_on_trips")]

    operations = [
        migrations.AlterField(
            model_name="stockbatch",
            name="status",
            field=models.CharField(default="HEALTHY", max_length=50),
        ),
        migrations.RunPython(active_to_healthy, healthy_to_active),
    ]
