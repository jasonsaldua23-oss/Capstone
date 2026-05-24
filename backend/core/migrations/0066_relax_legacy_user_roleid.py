from django.db import migrations


def relax_legacy_user_roleid(apps, schema_editor) -> None:
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return

    with connection.cursor() as cursor:
        cursor.execute(
            """
            select 1
            from information_schema.columns
            where table_schema = 'public' and table_name = 'User' and column_name = 'roleId'
            """
        )
        if cursor.fetchone() is None:
            return

        cursor.execute('alter table "User" alter column "roleId" drop not null')


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0065_reconcile_postgres_schema_with_django_models"),
    ]

    operations = [
        migrations.RunPython(relax_legacy_user_roleid, migrations.RunPython.noop),
    ]
