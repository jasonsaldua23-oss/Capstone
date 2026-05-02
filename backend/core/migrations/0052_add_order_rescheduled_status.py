# Generated migration to add RESCHEDULED status

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0051_merge_0049_clear_data_0050_delete_feedback"),
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
                    ("RESCHEDULED", "Rescheduled"),
                    ("OUT_FOR_DELIVERY", "Out For Delivery"),
                    ("DELIVERED", "Delivered"),
                    ("CANCELLED", "Cancelled"),
                ],
                default="PENDING",
                max_length=50,
            ),
        ),
    ]
