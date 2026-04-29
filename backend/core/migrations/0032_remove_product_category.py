from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0031_remove_order_payment_method"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="product",
            name="category",
        ),
        migrations.DeleteModel(
            name="ProductCategory",
        ),
    ]
