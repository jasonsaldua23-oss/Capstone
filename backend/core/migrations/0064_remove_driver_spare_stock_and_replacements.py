from django.db import migrations


def delete_driver_reported_replacements(apps, schema_editor):
    Replacement = apps.get_model("core", "Replacement")
    Replacement.objects.filter(
        requested_by="DRIVER",
    ).delete()
    Replacement.objects.filter(
        replacement_mode__in=["SPARE_PRODUCTS_IMMEDIATE", "SPARE_PRODUCTS_PARTIAL"],
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0063_backfill_trip_created_by_user_id"),
    ]

    operations = [
        migrations.RunPython(delete_driver_reported_replacements, migrations.RunPython.noop),
        migrations.DeleteModel(
            name="DriverSpareStock",
        ),
    ]
