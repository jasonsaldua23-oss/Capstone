from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0024_remove_tripdroppoint_planned_arrival_and_more"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="driver",
            name="license_photo",
        ),
    ]

