from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0025_remove_driver_license_photo"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="trip",
            name="actual_time",
        ),
        migrations.RemoveField(
            model_name="trip",
            name="end_latitude",
        ),
        migrations.RemoveField(
            model_name="trip",
            name="end_location",
        ),
        migrations.RemoveField(
            model_name="trip",
            name="end_longitude",
        ),
        migrations.RemoveField(
            model_name="trip",
            name="estimated_time",
        ),
        migrations.RemoveField(
            model_name="trip",
            name="planned_end_at",
        ),
        migrations.RemoveField(
            model_name="trip",
            name="start_location",
        ),
        migrations.RemoveField(
            model_name="trip",
            name="total_distance",
        ),
    ]

