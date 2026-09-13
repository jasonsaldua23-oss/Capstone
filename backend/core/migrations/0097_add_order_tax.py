from django.db import migrations, models


def add_order_tax_column(apps, schema_editor):
    # The initial Django schema already includes ``tax``. This repair is only
    # needed for older PostgreSQL databases and uses PostgreSQL-only syntax.
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "tax" double precision DEFAULT 0.0;')


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0096_remove_order_warehouse_stage"),
    ]

    operations = [
        migrations.RunPython(add_order_tax_column, migrations.RunPython.noop),
    ]
