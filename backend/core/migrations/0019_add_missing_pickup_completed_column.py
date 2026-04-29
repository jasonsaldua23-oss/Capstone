from django.db import migrations


def _ensure_pickup_completed_column(apps, schema_editor):
    table = "Replacement"
    column = "pickup_completed"
    vendor = schema_editor.connection.vendor

    with schema_editor.connection.cursor() as cursor:
        if vendor == "postgresql":
            cursor.execute(
                'ALTER TABLE "Replacement" ADD COLUMN IF NOT EXISTS "pickup_completed" timestamp with time zone NULL;'
            )
            return

        if vendor == "sqlite":
            cursor.execute(f'PRAGMA table_info("{table}")')
            columns = {row[1] for row in cursor.fetchall()}
            if column not in columns:
                cursor.execute(f'ALTER TABLE "{table}" ADD COLUMN "{column}" datetime NULL;')


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0018_rename_return_to_replacement"),
    ]

    operations = [
        migrations.RunPython(_ensure_pickup_completed_column, migrations.RunPython.noop),
    ]
