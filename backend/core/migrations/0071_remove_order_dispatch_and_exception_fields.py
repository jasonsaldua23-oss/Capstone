from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0070_remove_order_checklist_quantity_verified"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(
                    code=lambda apps, schema_editor: schema_editor.connection.cursor().execute("""
                    ALTER TABLE "Order" DROP COLUMN IF EXISTS "dispatch_signed_off_by";
                    ALTER TABLE "Order" DROP COLUMN IF EXISTS "dispatch_signed_off_user_id";
                    ALTER TABLE "Order" DROP COLUMN IF EXISTS "dispatch_signed_off_at";
                    ALTER TABLE "Order" DROP COLUMN IF EXISTS "exception_short_load_qty";
                    ALTER TABLE "Order" DROP COLUMN IF EXISTS "exception_damaged_on_loading_qty";
                    ALTER TABLE "Order" DROP COLUMN IF EXISTS "exception_hold_reason";
                    ALTER TABLE "Order" DROP COLUMN IF EXISTS "exception_notes";
                    """) if schema_editor.connection.vendor == 'postgresql' else None,
                    reverse_code=migrations.RunPython.noop,
                ),
            ],
            state_operations=[
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
            ],
        ),
    ]
