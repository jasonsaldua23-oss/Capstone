from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone

import core.models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0110_driver_service_areas"),
    ]

    operations = [
        migrations.CreateModel(
            name="OrderDepositRefundClaim",
            fields=[
                ("id", models.CharField(default=core.models.generate_cuid, editable=False, max_length=25, primary_key=True, serialize=False)),
                ("product_name", models.CharField(max_length=255)),
                ("requested_quantity", models.PositiveIntegerField()),
                ("collected_quantity", models.PositiveIntegerField(default=0)),
                ("deposit_per_container", models.DecimalField(decimal_places=2, max_digits=10)),
                ("requested_amount", models.DecimalField(decimal_places=2, max_digits=12)),
                ("collected_amount", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("status", models.CharField(choices=[("PENDING", "Pending collection"), ("SETTLED", "Collected"), ("PARTIAL", "Partially collected"), ("REJECTED", "Not collected")], default="PENDING", max_length=20)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("container_type", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="order_refund_claims", to="core.containertype")),
                ("order", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="deposit_refund_claims", to="core.order")),
                ("product", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="deposit_refund_claims", to="core.product")),
            ],
            options={"db_table": "OrderDepositRefundClaim"},
        ),
        migrations.AddConstraint(
            model_name="orderdepositrefundclaim",
            constraint=models.UniqueConstraint(fields=("order", "product", "container_type"), name="unique_order_product_refund_claim"),
        ),
    ]
