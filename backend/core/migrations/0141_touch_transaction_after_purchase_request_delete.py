from django.db import migrations


FUNCTION_NAME = "core_touch_transaction_after_purchase_request_delete"
TRIGGER_NAME = "core_touch_transaction_after_purchase_request_delete"


def create_parent_touch_trigger(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return

    quote = schema_editor.quote_name
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            f"""
            CREATE OR REPLACE FUNCTION {quote(FUNCTION_NAME)}()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                -- Fix: order delta refreshes watch the parent timestamp. Touch it
                -- when a PR is deleted directly so cached navigation rows are replaced.
                UPDATE {quote('Transaction')} AS parent
                SET {quote('updated_at')} = clock_timestamp()
                FROM deleted_purchase_requests
                WHERE parent.{quote('id')} = deleted_purchase_requests.{quote('transaction_id')};
                RETURN NULL;
            END;
            $$;
            """
        )
        cursor.execute(
            f"""
            CREATE TRIGGER {quote(TRIGGER_NAME)}
            AFTER DELETE ON {quote('PurchaseRequest')}
            REFERENCING OLD TABLE AS deleted_purchase_requests
            FOR EACH STATEMENT
            EXECUTE FUNCTION {quote(FUNCTION_NAME)}();
            """
        )


def remove_parent_touch_trigger(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return

    quote = schema_editor.quote_name
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            f"DROP TRIGGER IF EXISTS {quote(TRIGGER_NAME)} ON {quote('PurchaseRequest')};"
        )
        cursor.execute(f"DROP FUNCTION IF EXISTS {quote(FUNCTION_NAME)}();")


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0140_sync_stamps_for_direct_deletes"),
    ]

    operations = [
        migrations.RunPython(create_parent_touch_trigger, remove_parent_touch_trigger),
    ]
