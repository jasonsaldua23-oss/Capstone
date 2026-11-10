from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0154_damaged_stock")]
    # Added: whether a rating is for the products or the service. Existing ratings were
    # the single "Delivery Rating", so they become SERVICE.
    operations = [
        migrations.AddField(
            model_name="feedback",
            name="rating_target",
            field=models.CharField(
                choices=[("PRODUCT", "Product"), ("SERVICE", "Service")], default="SERVICE", max_length=20,
            ),
        ),
    ]
