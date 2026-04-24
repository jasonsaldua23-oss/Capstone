import core.models
import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0011_remove_driversparestock_driver_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="DriverSpareStock",
            fields=[
                ("id", models.CharField(default=core.models.generate_cuid, editable=False, max_length=25, primary_key=True, serialize=False)),
                ("quantity", models.IntegerField(default=0)),
                ("min_quantity", models.IntegerField(default=0)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("driver", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="spare_stock", to="core.driver")),
                ("product", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="spare_stock", to="core.product")),
            ],
            options={
                "db_table": "DriverSpareStock",
            },
        ),
        migrations.CreateModel(
            name="SpareStockTransaction",
            fields=[
                ("id", models.CharField(default=core.models.generate_cuid, editable=False, max_length=25, primary_key=True, serialize=False)),
                ("type", models.CharField(max_length=50)),
                ("quantity", models.IntegerField()),
                ("reference_type", models.CharField(blank=True, max_length=100, null=True)),
                ("reference_id", models.CharField(blank=True, max_length=100, null=True)),
                ("notes", models.TextField(blank=True, null=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("driver", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="spare_stock_transactions", to="core.driver")),
                ("product", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="spare_stock_transactions", to="core.product")),
            ],
            options={
                "db_table": "SpareStockTransaction",
            },
        ),
        migrations.AddConstraint(
            model_name="driversparestock",
            constraint=models.UniqueConstraint(fields=("driver", "product"), name="unique_driver_spare_stock"),
        ),
    ]
