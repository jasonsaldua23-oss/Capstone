from django.db import migrations, models


def forwards(apps, schema_editor):
    Return = apps.get_model("core", "Return")
    Return.objects.filter(status="REQUESTED").update(status="REPORTED")
    Return.objects.filter(status__in=["APPROVED", "PICKED_UP", "IN_TRANSIT", "RECEIVED"]).update(status="IN_PROGRESS")
    Return.objects.filter(status="REJECTED").update(status="NEEDS_FOLLOW_UP")
    Return.objects.filter(status="PROCESSED", replacement_mode="SPARE_STOCK_IMMEDIATE").update(status="RESOLVED_ON_DELIVERY")
    Return.objects.filter(status="PROCESSED").exclude(replacement_mode="SPARE_STOCK_IMMEDIATE").update(status="COMPLETED")


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0008_order_status_preparing_only"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="return",
            name="status",
            field=models.CharField(
                choices=[
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
