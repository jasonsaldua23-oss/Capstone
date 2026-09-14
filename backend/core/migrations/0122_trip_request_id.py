from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0121_order_deposit_refund_request"),
    ]

    operations = [
        migrations.AddField(
            model_name="trip",
            name="request_id",
            field=models.CharField(blank=True, max_length=120, null=True, unique=True),
        ),
    ]
