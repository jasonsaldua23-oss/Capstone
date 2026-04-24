from django.db import migrations, models


PRODUCT_UNIT_CASE = "case"
PRODUCT_UNIT_PACK_BUNDLE = "pack(bundle)"


def normalize_product_units(apps, schema_editor):
    Product = apps.get_model("core", "Product")
    for product in Product.objects.all().only("id", "unit"):
        value = str(product.unit or "").strip().lower()
        if value in {"pack", "bundle", PRODUCT_UNIT_PACK_BUNDLE, "pack (bundle)"}:
            normalized = PRODUCT_UNIT_PACK_BUNDLE
        else:
            normalized = PRODUCT_UNIT_CASE
        if product.unit != normalized:
            Product.objects.filter(pk=product.pk).update(unit=normalized)


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0012_restore_driver_spare_stock_models"),
    ]

    operations = [
        migrations.AlterField(
            model_name="product",
            name="unit",
            field=models.CharField(default="case", max_length=50),
        ),
        migrations.RunPython(normalize_product_units, migrations.RunPython.noop),
    ]
