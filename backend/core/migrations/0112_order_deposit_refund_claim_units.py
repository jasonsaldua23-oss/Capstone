from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0111_order_deposit_refund_claim"),
    ]

    operations = [
        migrations.AddField(
            model_name="orderdepositrefundclaim",
            name="requested_cases",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="orderdepositrefundclaim",
            name="requested_loose_bottles",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="orderdepositrefundclaim",
            name="containers_per_case",
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name="orderdepositrefundclaim",
            name="case_deposit_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
    ]
