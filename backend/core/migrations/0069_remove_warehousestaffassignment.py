from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0068_cleanup_legacy_prisma_leftovers"),
    ]

    operations = [
        migrations.DeleteModel(
            name="WarehouseStaffAssignment",
        ),
    ]
