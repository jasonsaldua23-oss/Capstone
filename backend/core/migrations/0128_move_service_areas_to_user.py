from django.db import migrations, models


def move_assignments(apps, schema_editor):
    User = apps.get_model("core", "User")
    Area = apps.get_model("core", "DriverServiceArea")
    alias = schema_editor.connection.alias
    # Keep the copy and table removal atomic, including against concurrent writers.
    if schema_editor.connection.vendor == "postgresql":
        tables = ", ".join(schema_editor.quote_name(model._meta.db_table) for model in (User, Area))
        schema_editor.execute(f"LOCK TABLE {tables} IN ACCESS EXCLUSIVE MODE")
    assignments = {}
    for area in Area.objects.using(alias).order_by("id").iterator():
        assignments.setdefault(area.driver_id, []).append({
            "city": area.city,
            "assigned_by": area.assigned_by,
            "assigned_at": area.assigned_at.isoformat(),
        })
    for driver_id, areas in assignments.items():
        User.objects.using(alias).filter(pk=driver_id).update(service_area_data=areas)


def restore_assignments(apps, schema_editor):
    User = apps.get_model("core", "User")
    Area = apps.get_model("core", "DriverServiceArea")
    alias = schema_editor.connection.alias
    # Reversing restores the original cities and per-city audit details.
    # Read only the fields this reverse copy needs. Later migrations may remove
    # unrelated User columns while migration round-trip tests exercise this step.
    for user in User.objects.using(alias).only("id", "service_area_data").iterator():
        for area in user.service_area_data:
            Area.objects.using(alias).create(driver_id=user.pk, **area)


class Migration(migrations.Migration):
    dependencies = [("core", "0127_remove_unused_return_receipts")]

    operations = [
        # A temporary name avoids colliding with the old reverse relation during copying.
        migrations.AddField(
            model_name="user", name="service_area_data",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(move_assignments, restore_assignments),
        migrations.DeleteModel(name="DriverServiceArea"),
        migrations.RenameField(model_name="user", old_name="service_area_data", new_name="service_areas"),
    ]
