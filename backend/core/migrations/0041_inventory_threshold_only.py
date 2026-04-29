from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0040_remove_product_dimensions"),
    ]

    operations = [
        migrations.RenameField(
            model_name="inventory",
            old_name="min_stock",
            new_name="threshold",
        ),
        migrations.RemoveField(
            model_name="inventory",
            name="max_stock",
        ),
        migrations.RemoveField(
            model_name="inventory",
            name="reorder_point",
        ),
    ]

