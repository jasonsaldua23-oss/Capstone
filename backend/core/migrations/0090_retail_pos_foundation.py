"""Non-destructive Retail/POS foundation.

The discarded generated 0090 attempted to remove already-applied purchase,
mixed-case, inventory snapshot, and RGB models. This replacement preserves the
0089 schema. Additive POS operations are added after model reconciliation.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0089_vehicle_brand_model_year_classification"),
    ]

    # Add only product and immutable line snapshots in this foundation step.
    operations = [
        migrations.AddField(model_name="product", name="case_price", field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
        migrations.AddField(model_name="product", name="retail_unit_price", field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
        migrations.AddField(model_name="orderitem", name="deposit_total", field=models.DecimalField(decimal_places=2, default=0, max_digits=12)),
        migrations.AddField(model_name="orderitem", name="empty_covered_quantity", field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name="orderitem", name="packaging_type_snapshot", field=models.CharField(blank=True, max_length=100, null=True)),
        migrations.AddField(model_name="orderitem", name="product_category", field=models.CharField(blank=True, max_length=150, null=True)),
        migrations.AddField(model_name="orderitem", name="product_subtotal", field=models.DecimalField(decimal_places=2, default=0, max_digits=12)),
        migrations.AddField(model_name="orderitem", name="sale_mode", field=models.CharField(blank=True, choices=[("LOOSE", "Loose"), ("CASE", "Case"), ("MIXED_CASE", "Mixed Case")], max_length=20, null=True)),
        migrations.AddField(model_name="mixedcasecomponent", name="container_type_id", field=models.CharField(blank=True, max_length=25, null=True)),
        migrations.AddField(model_name="mixedcasecomponent", name="container_type_name", field=models.CharField(blank=True, max_length=255, null=True)),
        migrations.AddField(model_name="mixedcasecomponent", name="deposit_per_unit", field=models.DecimalField(decimal_places=2, default=0, max_digits=10)),
        migrations.AddField(model_name="mixedcasecomponent", name="deposit_total", field=models.DecimalField(decimal_places=2, default=0, max_digits=12)),
        migrations.AddField(model_name="mixedcasecomponent", name="empty_covered_quantity", field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name="mixedcasecomponent", name="packaging_type_snapshot", field=models.CharField(blank=True, max_length=100, null=True)),
        migrations.AddField(model_name="mixedcasecomponent", name="product_category", field=models.CharField(blank=True, max_length=150, null=True)),
    ]
