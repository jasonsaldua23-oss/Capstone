from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0100_add_speed_to_locationlog"),
    ]

    operations = [
        migrations.AlterField(
            model_name="order",
            name="sales_channel",
            field=models.CharField(
                choices=[("ONLINE", "Online"), ("RETAIL_POS", "Retail")],
                db_index=True,
                default="ONLINE",
                max_length=20,
            ),
        ),
    ]
