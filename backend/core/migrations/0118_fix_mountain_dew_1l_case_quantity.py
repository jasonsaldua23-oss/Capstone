from django.db import migrations


PRODUCT_SKU = "MOUN-CAS-1LIT-E4R4Q"


def correct_case_quantity(apps, schema_editor):
    Product = apps.get_model("core", "Product")
    # Fix: the 1L returnable case uses twelve bottles; the old product row
    # incorrectly stored 24 and consequently doubled its calculated weight.
    Product.objects.filter(sku=PRODUCT_SKU).update(quantity_per_unit=12, weight=18.6)


def restore_case_quantity(apps, schema_editor):
    Product = apps.get_model("core", "Product")
    Product.objects.filter(sku=PRODUCT_SKU).update(quantity_per_unit=24, weight=37.2)


class Migration(migrations.Migration):
    dependencies = [("core", "0117_remove_non_glass_7up_deposit")]

    operations = [migrations.RunPython(correct_case_quantity, restore_case_quantity)]
