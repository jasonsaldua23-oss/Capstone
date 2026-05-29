from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0073_force_orderitem_product_nullable"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="category",
            field=models.CharField(blank=True, max_length=150, null=True),
        ),
    ]

