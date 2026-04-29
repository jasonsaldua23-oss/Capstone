from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0034_vehicle_driver_direct_assignment"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="driver",
            name="phone",
        ),
    ]
