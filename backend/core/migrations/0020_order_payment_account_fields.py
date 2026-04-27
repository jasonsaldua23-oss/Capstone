from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0019_add_missing_pickup_completed_column"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="payment_account_name",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="payment_account_reference",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
    ]
