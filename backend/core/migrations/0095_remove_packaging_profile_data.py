from django.db import migrations


def remove_packaging_profile_data(apps, schema_editor):
    """Detach legacy profile links before deleting the obsolete profile rows."""
    Product = apps.get_model("core", "Product")
    ProductPackaging = apps.get_model("core", "ProductPackaging")
    PackagingProfile = apps.get_model("core", "PackagingProfile")

    Product.objects.exclude(packaging_profile_id=None).update(packaging_profile_id=None)
    ProductPackaging.objects.exclude(packaging_profile_id=None).update(packaging_profile_id=None)
    PackagingProfile.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("core", "0094_inventory_transaction_unit_snapshot")]

    operations = [
        migrations.RunPython(remove_packaging_profile_data, migrations.RunPython.noop),
    ]
