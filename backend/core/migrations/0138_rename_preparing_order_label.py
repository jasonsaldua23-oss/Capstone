from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0137_reuse_replacement_number_for_delivery")]

    operations = [
        migrations.AlterField(
            model_name="order",
            name="status",
            field=models.CharField(
                choices=[
                    ("PENDING", "Pending"),
                    ("CONFIRMED", "Confirmed"),
                    ("PREPARING", "Processing"),
                    ("RESCHEDULED", "Rescheduled"),
                    ("OUT_FOR_DELIVERY", "Out For Delivery"),
                    ("DELIVERED", "Delivered"),
                    ("REJECTED", "Rejected"),
                    ("CANCELLED", "Cancelled"),
                ],
                default="PENDING",
                max_length=50,
            ),
        ),
    ]
