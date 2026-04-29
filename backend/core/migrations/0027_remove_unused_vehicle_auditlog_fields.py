from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0026_remove_unused_trip_fields"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="auditlog",
            name="ip_address",
        ),
        migrations.RemoveField(
            model_name="auditlog",
            name="user_agent",
        ),
        migrations.RemoveField(
            model_name="vehicle",
            name="last_maintenance",
        ),
        migrations.RemoveField(
            model_name="vehicle",
            name="next_maintenance",
        ),
    ]

