from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0014_order_checklist_spare_products_verified"),
    ]

    operations = [
        migrations.AlterField(
            model_name="user",
            name="email",
            field=models.EmailField(max_length=254),
        ),
    ]
