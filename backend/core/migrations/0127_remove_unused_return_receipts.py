from django.db import migrations


def require_empty_receipts(apps, schema_editor):
    # Retire only empty tables; lock them until the atomic migration finishes
    # so a concurrent writer cannot add a receipt between the check and drop.
    models = [apps.get_model("core", name) for name in ("ReturnReceipt", "ReturnReceiptLine")]
    if schema_editor.connection.vendor == "postgresql":
        tables = ", ".join(schema_editor.quote_name(model._meta.db_table) for model in models)
        schema_editor.execute(f"LOCK TABLE {tables} IN ACCESS EXCLUSIVE MODE")
    for model in models:
        if model.objects.using(schema_editor.connection.alias).exists():
            raise RuntimeError(f"Cannot remove {model._meta.db_table}: receipt data must be preserved.")


class Migration(migrations.Migration):
    dependencies = [("core", "0126_customer_approval_status")]

    operations = [
        migrations.RunPython(require_empty_receipts, migrations.RunPython.noop),
        migrations.DeleteModel(name="ReturnReceiptLine"),
        migrations.DeleteModel(name="ReturnReceipt"),
    ]
