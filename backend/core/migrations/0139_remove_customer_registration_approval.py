from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0138_rename_preparing_order_label"),
    ]

    operations = [
        migrations.RemoveField(model_name="customer", name="approval_status"),
        migrations.RemoveField(model_name="customer", name="approval_reviewed_at"),
        migrations.RemoveField(model_name="customer", name="approval_reviewed_by_user_id"),
        migrations.RemoveField(model_name="customer", name="approval_reviewed_by_name"),
        migrations.RemoveField(model_name="customer", name="approval_notes"),
    ]
