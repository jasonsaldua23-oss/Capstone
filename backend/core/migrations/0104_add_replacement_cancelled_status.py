from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0103_add_push_subscription"),
    ]

    operations = [
        migrations.AlterField(
            model_name="replacement",
            name="status",
            field=models.CharField(
                choices=[
                    ("PENDING", "Pending"),
                    ("UNDER_REVIEW", "Under Review"),
                    ("APPROVED", "Approved"),
                    ("REJECTED", "Rejected"),
                    ("CANCELLED", "Cancelled"),
                    ("REPORTED", "Reported"),
                    ("IN_PROGRESS", "In Progress"),
                    ("RESOLVED_ON_DELIVERY", "Resolved On Delivery"),
                    ("NEEDS_FOLLOW_UP", "Needs Follow Up"),
                    ("COMPLETED", "Completed"),
                ],
                default="REPORTED",
                max_length=50,
            ),
        ),
    ]
