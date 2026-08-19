from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0087_remove_warehouse_contact_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="productpackaging",
            name="case_deposit_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name="customerbottlebalance",
            name="deposit_balance",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
    ]
