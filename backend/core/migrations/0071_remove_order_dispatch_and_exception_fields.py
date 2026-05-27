from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0070_remove_order_checklist_quantity_verified"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="order",
            name="dispatch_signed_off_by",
        ),
        migrations.RemoveField(
            model_name="order",
            name="dispatch_signed_off_user_id",
        ),
        migrations.RemoveField(
            model_name="order",
            name="dispatch_signed_off_at",
        ),
        migrations.RemoveField(
            model_name="order",
            name="exception_short_load_qty",
        ),
        migrations.RemoveField(
            model_name="order",
            name="exception_damaged_on_loading_qty",
        ),
        migrations.RemoveField(
            model_name="order",
            name="exception_hold_reason",
        ),
        migrations.RemoveField(
            model_name="order",
            name="exception_notes",
        ),
    ]

