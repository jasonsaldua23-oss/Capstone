from django.db import migrations


def backfill_trip_creator(apps, schema_editor):
    connection = schema_editor.connection

    def get_columns(table_name):
        with connection.cursor() as cursor:
            description = connection.introspection.get_table_description(cursor, table_name)
        return {column.name for column in description}

    table_names = set(connection.introspection.table_names())
    if "Warehouse" not in table_names or "Trip" not in table_names:
        return

    warehouse_columns = get_columns("Warehouse")
    trip_columns = get_columns("Trip")

    warehouse_manager_column = "managerId" if "managerId" in warehouse_columns else "manager_id" if "manager_id" in warehouse_columns else None
    trip_warehouse_column = "warehouseId" if "warehouseId" in trip_columns else "warehouse_id" if "warehouse_id" in trip_columns else None
    trip_created_by_column = "created_by_user_id" if "created_by_user_id" in trip_columns else None

    if not warehouse_manager_column or not trip_warehouse_column or not trip_created_by_column:
        return

    with connection.cursor() as cursor:
        cursor.execute(f'SELECT "id", "{warehouse_manager_column}" FROM "Warehouse"')
        warehouse_manager_by_id = {
            str(row[0] or "").strip(): str(row[1] or "").strip()
            for row in cursor.fetchall()
            if str(row[0] or "").strip()
        }

        cursor.execute(
            f'SELECT "id", "{trip_warehouse_column}" FROM "Trip" WHERE "{trip_created_by_column}" IS NULL'
        )
        for trip_id, warehouse_id in cursor.fetchall():
            manager_id = warehouse_manager_by_id.get(str(warehouse_id or "").strip(), "")
            if not manager_id:
                continue
            cursor.execute(
                f'UPDATE "Trip" SET "{trip_created_by_column}" = %s WHERE "id" = %s',
                [manager_id, trip_id],
            )


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0062_trip_created_by_user_id"),
    ]

    operations = [
        migrations.RunPython(backfill_trip_creator, migrations.RunPython.noop),
    ]

