from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0013_product_unit_case_pack_bundle"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="checklist_spare_products_verified",
            field=models.BooleanField(default=False),
        ),
    ]
