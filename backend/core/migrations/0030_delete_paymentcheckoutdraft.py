from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0029_orderlogistics_into_order"),
    ]

    operations = [
        migrations.DeleteModel(
            name="PaymentCheckoutDraft",
        ),
    ]
