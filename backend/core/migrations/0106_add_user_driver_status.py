from django.db import migrations, models


def preserve_inactive_driver_statuses(apps, schema_editor):
    """Keep existing inactive driver accounts visibly inactive after migration."""
    User = apps.get_model("core", "User")
    User.objects.filter(role="DRIVER", is_active=False).update(driver_status="INACTIVE")


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0105_backfill_product_weights"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="driver_status",
            field=models.CharField(
                choices=[
                    ("ACTIVE", "Active"),
                    ("ON_LEAVE", "On Leave"),
                    ("INACTIVE", "Inactive"),
                ],
                default="ACTIVE",
                max_length=20,
            ),
        ),
        migrations.RunPython(preserve_inactive_driver_statuses, migrations.RunPython.noop),
    ]
