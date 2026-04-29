from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0030_delete_paymentcheckoutdraft"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="order",
            name="payment_method",
        ),
    ]
