from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0009_return_status_workflow"),
    ]

    operations = [
        migrations.AlterField(
            model_name="order",
            name="status",
            field=models.CharField(
                choices=[
                    ("PENDING", "Pending"),
                    ("CONFIRMED", "Confirmed"),
                    ("PREPARING", "Preparing"),
                    ("OUT_FOR_DELIVERY", "Out For Delivery"),
                    ("DELIVERED", "Delivered"),
                    ("CANCELLED", "Cancelled"),
                ],
                default="PENDING",
                max_length=50,
            ),
        ),
    ]
