from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0027_remove_unused_vehicle_auditlog_fields"),
    ]

    operations = [
        migrations.DeleteModel(
            name="AuditLog",
        ),
    ]

