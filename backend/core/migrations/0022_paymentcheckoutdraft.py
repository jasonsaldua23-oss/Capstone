from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone

import core.models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0021_remove_order_payment_account_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="PaymentCheckoutDraft",
            fields=[
                ("id", models.CharField(default=core.models.generate_cuid, editable=False, max_length=25, primary_key=True, serialize=False)),
                ("payment_method", models.CharField(max_length=100)),
                ("payload", models.JSONField(default=dict)),
                ("subtotal", models.FloatField(default=0)),
                ("tax", models.FloatField(default=0)),
                ("shipping_cost", models.FloatField(default=0)),
                ("discount", models.FloatField(default=0)),
                ("total_amount", models.FloatField(default=0)),
                ("status", models.CharField(default="PENDING", max_length=30)),
                ("checkout_url", models.TextField(blank=True, null=True)),
                ("paymongo_checkout_id", models.CharField(blank=True, max_length=120, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("customer", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="payment_checkout_drafts", to="core.customer")),
                ("order", models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="checkout_draft", to="core.order")),
            ],
            options={
                "db_table": "PaymentCheckoutDraft",
            },
        ),
    ]
