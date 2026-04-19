from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0004_driver_license_photo"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="vehicle",
            name="make",
        ),
        migrations.RemoveField(
            model_name="vehicle",
            name="model",
        ),
        migrations.RemoveField(
            model_name="vehicle",
            name="year",
        ),
        migrations.RemoveField(
            model_name="vehicle",
            name="fuel_type",
        ),
    ]
