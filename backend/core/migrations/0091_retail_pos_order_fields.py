"""Add the Retail/POS order-channel and payment snapshots."""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0090_retail_pos_foundation"),
    ]

    operations = [
        migrations.AddField(model_name="order", name="amount_paid", field=models.DecimalField(decimal_places=2, default=0, max_digits=12)),
        migrations.AddField(model_name="order", name="created_by_name", field=models.CharField(blank=True, max_length=255, null=True)),
        migrations.AddField(
            model_name="order",
            name="created_by_user",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="retail_orders_created", to="core.user"),
        ),
        migrations.AddField(model_name="order", name="fulfillment_type", field=models.CharField(blank=True, choices=[("IMMEDIATE", "Immediate / Walk-in Sale"), ("CUSTOMER_PICKUP", "Customer Pickup")], max_length=30, null=True)),
        migrations.AddField(model_name="order", name="pickup_status", field=models.CharField(choices=[("NOT_APPLICABLE", "Not Applicable"), ("PENDING_PICKUP", "Pending Pickup"), ("READY_FOR_PICKUP", "Ready for Pickup"), ("PICKED_UP_COMPLETED", "Picked Up / Completed"), ("CANCELLED", "Cancelled")], db_index=True, default="NOT_APPLICABLE", max_length=30)),
        migrations.AddField(model_name="order", name="remaining_balance", field=models.DecimalField(decimal_places=2, default=0, max_digits=12)),
        migrations.AddField(model_name="order", name="retail_request_id", field=models.CharField(blank=True, max_length=120, null=True, unique=True)),
        migrations.AddField(model_name="order", name="retail_status", field=models.CharField(blank=True, choices=[("OPEN", "Open"), ("RESERVED", "Reserved"), ("COMPLETED", "Completed"), ("CANCELLED", "Cancelled")], db_index=True, max_length=20, null=True)),
        migrations.AddField(model_name="order", name="retail_transaction_number", field=models.CharField(blank=True, max_length=120, null=True, unique=True)),
        migrations.AddField(model_name="order", name="sales_channel", field=models.CharField(choices=[("ONLINE", "Online"), ("RETAIL_POS", "Retail / POS")], db_index=True, default="ONLINE", max_length=20)),
        migrations.AddField(model_name="order", name="walk_in_contact", field=models.CharField(blank=True, max_length=100, null=True)),
        migrations.AddField(model_name="order", name="walk_in_name", field=models.CharField(blank=True, max_length=255, null=True)),
        migrations.AddField(model_name="order", name="walk_in_notes", field=models.TextField(blank=True, null=True)),
    ]
