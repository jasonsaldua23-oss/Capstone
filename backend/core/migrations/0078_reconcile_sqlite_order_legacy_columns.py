from django.db import migrations


LEGACY_ORDER_COLUMNS = [
    "dispatch_signed_off_by",
    "dispatch_signed_off_user_id",
    "dispatch_signed_off_at",
    "exception_short_load_qty",
    "exception_damaged_on_loading_qty",
    "exception_hold_reason",
    "exception_notes",
]


def reconcile_sqlite_order_legacy_columns(apps, schema_editor) -> None:
    if schema_editor.connection.vendor != "sqlite":
        return

    with schema_editor.connection.cursor() as cursor:
        cursor.execute('PRAGMA table_info("Order")')
        existing_columns = {row[1] for row in cursor.fetchall()}

        for column_name in LEGACY_ORDER_COLUMNS:
            if column_name not in existing_columns:
                continue
            cursor.execute(f'ALTER TABLE "Order" DROP COLUMN "{column_name}"')


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0077_alter_user_license_type_length"),
    ]

    operations = [
        migrations.RunPython(
            reconcile_sqlite_order_legacy_columns,
            migrations.RunPython.noop,
        ),
    ]
