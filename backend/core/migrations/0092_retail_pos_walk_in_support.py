"""Allow walk-in POS audit records without creating a shared fake customer."""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0091_retail_pos_order_fields"),
    ]

    operations = [
        migrations.AlterField(
            model_name="order",
            name="customer",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="orders", to="core.customer"),
        ),
        migrations.AlterField(
            model_name="bottlereturn",
            name="customer",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="bottle_returns", to="core.customer"),
        ),
        migrations.AlterField(
            model_name="deposittransaction",
            name="customer",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="deposit_transactions", to="core.customer"),
        ),
        migrations.AlterField(
            model_name="deposittransaction",
            name="ledger",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="transactions", to="core.customerdepositledger"),
        ),
    ]
