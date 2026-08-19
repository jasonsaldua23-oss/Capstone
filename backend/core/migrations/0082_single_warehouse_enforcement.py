from django.db import migrations, models


def validate_single_warehouse(apps, schema_editor) -> None:
    Warehouse = apps.get_model("core", "Warehouse")
    rows = list(
        Warehouse.objects.order_by("created_at", "id").values("id", "name", "code")[:2]
    )
    if len(rows) > 1:
        labels = ", ".join(
            f"{row['name']} ({row['code']}, {row['id']})" for row in rows
        )
        raise RuntimeError(
            "Single-warehouse migration aborted because multiple warehouses exist: "
            f"{labels}. Choose the warehouse to retain and migrate data before retrying."
        )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0081_inventorytransaction_stock_snapshots"),
    ]

    operations = [
        migrations.RunPython(validate_single_warehouse, migrations.RunPython.noop),
        migrations.AddField(
            model_name="warehouse",
            name="contact_name",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name="warehouse",
            name="contact_email",
            field=models.EmailField(blank=True, max_length=254, null=True),
        ),
        migrations.AddField(
            model_name="warehouse",
            name="contact_phone",
            field=models.CharField(blank=True, max_length=50, null=True),
        ),
        migrations.RunSQL(
            sql=(
                'CREATE UNIQUE INDEX "Warehouse_singleton_key" '
                'ON "Warehouse" ((1));'
            ),
            reverse_sql='DROP INDEX IF EXISTS "Warehouse_singleton_key";',
        ),
    ]
