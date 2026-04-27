from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0020_order_payment_account_fields"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="order",
            name="payment_account_name",
        ),
        migrations.RemoveField(
            model_name="order",
            name="payment_account_reference",
        ),
    ]
