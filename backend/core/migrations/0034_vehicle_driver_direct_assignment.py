from django.db import migrations, models
import django.db.models.deletion


def backfill_vehicle_driver(apps, schema_editor):
    Vehicle = apps.get_model("core", "Vehicle")
    DriverVehicle = apps.get_model("core", "DriverVehicle")

    active_links = DriverVehicle.objects.filter(is_active=True).order_by("vehicle_id", "-assigned_at")
    assigned_vehicle_ids = set()
    for link in active_links:
        if link.vehicle_id in assigned_vehicle_ids:
            continue
        Vehicle.objects.filter(id=link.vehicle_id).update(driver_id=link.driver_id)
        assigned_vehicle_ids.add(link.vehicle_id)


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0033_delete_passwordresetotp"),
    ]

    operations = [
        migrations.AddField(
            model_name="vehicle",
            name="driver",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="assigned_vehicles", to="core.driver"),
        ),
        migrations.RunPython(backfill_vehicle_driver, migrations.RunPython.noop),
        migrations.DeleteModel(
            name="DriverVehicle",
        ),
    ]
