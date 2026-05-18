from django.db import migrations, models


def backfill_trip_creator(apps, schema_editor):
    Trip = apps.get_model("core", "Trip")
    Warehouse = apps.get_model("core", "Warehouse")
    warehouse_manager_by_id = {
        str(row.id): str(row.manager_id or "").strip()
        for row in Warehouse.objects.all()
    }
    for trip in Trip.objects.filter(created_by_user_id__isnull=True):
        warehouse_id = str(getattr(trip, "warehouse_id", "") or "").strip()
        manager_id = warehouse_manager_by_id.get(warehouse_id, "")
        if manager_id:
            trip.created_by_user_id = manager_id
            trip.save(update_fields=["created_by_user_id"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0061_warehousestaffassignment"),
    ]

    operations = [
        migrations.AddField(
            model_name="trip",
            name="created_by_user_id",
            field=models.CharField(blank=True, max_length=25, null=True),
        ),
        migrations.RunPython(backfill_trip_creator, migrations.RunPython.noop),
    ]
