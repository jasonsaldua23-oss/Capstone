from django.db import migrations, models

# The owner tier that sat above Admin. Admin is now the single administrator role.
LEGACY_OWNER_ROLE = "SUPER_ADMIN"


def merge_owner_into_admin(apps, schema_editor):
    User = apps.get_model("core", "User")
    # Changing the role also changes the session fingerprint, so the account signs in
    # again once and receives an Admin session. Use the migration connection even when
    # a database router is configured.
    User.objects.using(schema_editor.connection.alias).filter(role=LEGACY_OWNER_ROLE).update(role="ADMIN")


class Migration(migrations.Migration):
    dependencies = [("core", "0143_rename_confirmed_order_status_to_approved")]

    operations = [
        migrations.RunPython(merge_owner_into_admin, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="user",
            name="role",
            field=models.CharField(
                choices=[
                    ("ADMIN", "Admin"),
                    ("WAREHOUSE_STAFF", "Warehouse Staff"),
                    ("DRIVER", "Driver"),
                    ("CUSTOMER", "Customer"),
                ],
                default="CUSTOMER",
                max_length=50,
            ),
        ),
    ]
