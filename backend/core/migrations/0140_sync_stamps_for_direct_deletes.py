from django.db import migrations


# Fix: raw SQL/database-dashboard deletes bypass Django signals and API middleware.
# These PostgreSQL triggers advance the existing live-sync scopes once per delete
# statement, allowing open portals to refresh without polling entire collections.
DELETE_SCOPE_TABLES = {
    "Transaction": ("orders",),
    "PurchaseRequest": ("orders",),
    "PurchaseOrder": ("orders",),
    "RetailSale": ("orders",),
    "OrderCharge": ("orders",),
    "OrderItem": ("orders",),
    "OrderTimeline": ("orders",),
    "OrderDepositRefundClaim": ("orders",),
    "OrderDepositRefundRequest": ("orders",),
    "Inventory": ("inventory", "stocks"),
    "InventoryReservation": ("inventory", "stocks"),
    "StockBatch": ("stock-batches", "inventory", "stocks"),
    "InventoryTransaction": ("inventory-transactions", "inventory", "stocks"),
    "Product": ("products",),
    "ProductPackaging": ("products",),
    "ContainerType": ("products",),
    "MixedCaseComponent": ("products",),
    "Warehouse": ("warehouses",),
    "Trip": ("trips",),
    "TripDropPoint": ("trips",),
    "Vehicle": ("vehicles", "drivers"),
    "User": ("drivers",),
    "Customer": ("customers",),
    "CustomerBottleBalance": ("customers",),
    "CustomerDepositLedger": ("customers",),
    "DepositTransaction": ("customers", "orders"),
    "BottleReturn": ("orders",),
    "BottleReturnLine": ("orders",),
    "Replacement": ("orders", "replacements"),
    "ReplacementLine": ("replacements",),
    "Feedback": ("feedback",),
    "Notification": ("notifications",),
}

FUNCTION_NAME = "core_bump_sync_stamps_after_delete"
TRIGGER_NAME = "core_sync_stamp_after_delete"


def create_direct_delete_triggers(apps, schema_editor):
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
            DECLARE
                changed_scope text;
            BEGIN
                -- A statement deleting no rows must not publish a false change.
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
                RETURN NULL;
            END;
            $$;
            """
        )

        for table, scopes in DELETE_SCOPE_TABLES.items():
            trigger_args = ", ".join("'%s'" % scope.replace("'", "''") for scope in scopes)
            cursor.execute(
                f"""
                CREATE TRIGGER {quote(TRIGGER_NAME)}
                AFTER DELETE ON {quote(table)}
                REFERENCING OLD TABLE AS deleted_rows
                FOR EACH STATEMENT
                EXECUTE FUNCTION {quote(FUNCTION_NAME)}({trigger_args});
                """
            )


def remove_direct_delete_triggers(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return

    quote = schema_editor.quote_name
    with schema_editor.connection.cursor() as cursor:
        for table in DELETE_SCOPE_TABLES:
            cursor.execute(
                f"DROP TRIGGER IF EXISTS {quote(TRIGGER_NAME)} ON {quote(table)};"
            )
        cursor.execute(f"DROP FUNCTION IF EXISTS {quote(FUNCTION_NAME)}();")


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0139_remove_customer_registration_approval"),
    ]

    operations = [
        migrations.RunPython(create_direct_delete_triggers, remove_direct_delete_triggers),
    ]
