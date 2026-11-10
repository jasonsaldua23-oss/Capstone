import core.models
import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0153_vehicle_incident")]
    # Added: damaged warehouse stock held out of sellable inventory, with what became of it.
    operations = [migrations.CreateModel(
        name="DamagedStock",
        fields=[
            ("id", models.CharField(default=core.models.generate_cuid, editable=False, max_length=25, primary_key=True, serialize=False)),
            ("record_number", models.CharField(max_length=120, unique=True)),
            ("request_id", models.CharField(max_length=120)),
            ("batch_number", models.CharField(blank=True, default="", max_length=120)),
            ("cases", models.PositiveIntegerField(default=0)),
            ("loose_units", models.PositiveIntegerField(default=0)),
            ("units_per_case", models.PositiveIntegerField(default=1)),
            ("cases_opened", models.PositiveIntegerField(default=0)),
            ("cause", models.CharField(choices=[
                ("BROKEN_IN_WAREHOUSE", "Broken or dropped in the warehouse"),
                ("DAMAGED_IN_TRANSIT", "Damaged in transit"),
                ("DAMAGED_ON_ARRIVAL", "Damaged on arrival from the supplier"),
                ("LEAKING_OR_SPOILED", "Leaking or spoiled"),
                ("OTHER", "Other"),
            ], max_length=40)),
            ("description", models.TextField()),
            ("photo_url", models.CharField(blank=True, default="", max_length=500)),
            ("status", models.CharField(choices=[
                ("PENDING", "Pending"),
                ("DISPOSED", "Disposed"),
                ("RETURNED_TO_SUPPLIER", "Returned to supplier"),
                ("RESTOCKED", "Back in stock"),
            ], default="PENDING", max_length=30)),
            ("resolved_at", models.DateTimeField(blank=True, null=True)),
            ("resolution_notes", models.TextField(blank=True, default="")),
            ("loss_case_price", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
            ("loss_unit_price", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
            ("loss_amount", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
            ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
            ("updated_at", models.DateTimeField(auto_now=True)),
            ("inventory", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="damaged_stock", to="core.inventory")),
            ("product", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="damaged_stock", to="core.product")),
            ("recorded_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="recorded_damaged_stock", to="core.user")),
            ("resolved_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="resolved_damaged_stock", to="core.user")),
            ("stock_batch", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="damaged_stock", to="core.stockbatch")),
            ("warehouse", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="damaged_stock", to="core.warehouse")),
        ],
        options={
            "db_table": "DamagedStock",
            "indexes": [models.Index(fields=["warehouse", "status", "created_at"], name="damaged_stock_wh_status_time")],
            "constraints": [models.UniqueConstraint(fields=("warehouse", "request_id"), name="unique_damaged_stock_request")],
        },
    )]
