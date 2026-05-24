from django.db import migrations


def delete_driver_reported_replacements(apps, schema_editor):
    connection = schema_editor.connection
    table_names = set(connection.introspection.table_names())
    replacement_table = None
    if "Replacement" in table_names:
        replacement_table = "Replacement"
    elif "Return" in table_names:
        replacement_table = "Return"
    if not replacement_table:
        return

    with connection.cursor() as cursor:
        description = connection.introspection.get_table_description(cursor, replacement_table)
        columns = {column.name for column in description}

        requested_by_column = "requestedBy" if "requestedBy" in columns else "requested_by" if "requested_by" in columns else None
        replacement_mode_column = "replacementMode" if "replacementMode" in columns else "replacement_mode" if "replacement_mode" in columns else None

        statements = []
        params = []
        if requested_by_column:
            statements.append(f'"{requested_by_column}" = %s')
            params.append("DRIVER")
        if replacement_mode_column:
            statements.append(f'"{replacement_mode_column}" IN (%s, %s)')
            params.extend(["SPARE_PRODUCTS_IMMEDIATE", "SPARE_PRODUCTS_PARTIAL"])
        if not statements:
            return

        cursor.execute(
            f'DELETE FROM "{replacement_table}" WHERE ' + " OR ".join(statements),
            params,
        )


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0063_backfill_trip_created_by_user_id"),
    ]

    operations = [
        migrations.RunPython(delete_driver_reported_replacements, migrations.RunPython.noop),
        migrations.DeleteModel(
            name="DriverSpareStock",
        ),
    ]
