from django.db import migrations


FUNCTION_NAME = "core_bump_sync_stamps_after_delete"
DELETION_SCOPE = "deletions"


def _install_function(schema_editor, *, include_deletion_scope):
    quote = schema_editor.quote_name
    deletion_sql = ""
    if include_deletion_scope:
        deletion_sql = f"""
                -- Tell delta-based clients to replace the affected collection;
                -- an absent row cannot be represented by an update-only response.
                INSERT INTO {quote('SyncStamp')} ({quote('scope')}, {quote('revision')}, {quote('updated_at')})
                VALUES ('{DELETION_SCOPE}', 1, CURRENT_TIMESTAMP)
                ON CONFLICT ({quote('scope')}) DO UPDATE
                SET {quote('revision')} = {quote('SyncStamp')}.{quote('revision')} + 1,
                    {quote('updated_at')} = CURRENT_TIMESTAMP;
        """

    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            f"""
            CREATE OR REPLACE FUNCTION {quote(FUNCTION_NAME)}()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            DECLARE
                changed_scope text;
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM deleted_rows) THEN
                    RETURN NULL;
                END IF;

                FOREACH changed_scope IN ARRAY TG_ARGV LOOP
                    INSERT INTO {quote('SyncStamp')} ({quote('scope')}, {quote('revision')}, {quote('updated_at')})
                    VALUES (changed_scope, 1, CURRENT_TIMESTAMP)
                    ON CONFLICT ({quote('scope')}) DO UPDATE
                    SET {quote('revision')} = {quote('SyncStamp')}.{quote('revision')} + 1,
                        {quote('updated_at')} = CURRENT_TIMESTAMP;
                END LOOP;
                {deletion_sql}
                RETURN NULL;
            END;
            $$;
            """
        )


def add_deletion_marker(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return

    SyncStamp = apps.get_model("core", "SyncStamp")
    SyncStamp.objects.get_or_create(scope=DELETION_SCOPE, defaults={"revision": 0})
    _install_function(schema_editor, include_deletion_scope=True)


def remove_deletion_marker(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return

    _install_function(schema_editor, include_deletion_scope=False)
    apps.get_model("core", "SyncStamp").objects.filter(scope=DELETION_SCOPE).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0141_touch_transaction_after_purchase_request_delete"),
    ]

    operations = [
        migrations.RunPython(add_deletion_marker, remove_deletion_marker),
    ]
