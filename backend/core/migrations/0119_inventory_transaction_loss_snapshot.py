from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0118_fix_mountain_dew_1l_case_quantity")]

    operations = [
        # Added: preserve the monetary value recorded when stock is disposed.
        migrations.AddField(
            model_name="inventorytransaction",
            name="loss_unit_price",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="inventorytransaction",
            name="loss_amount",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
    ]
