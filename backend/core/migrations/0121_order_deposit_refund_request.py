from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone
import core.models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0120_global_account_email_uniqueness"),
    ]

    operations = [
        migrations.CreateModel(
            name="OrderDepositRefundRequest",
            fields=[
                ("id", models.CharField(default=core.models.generate_cuid, editable=False, max_length=25, primary_key=True, serialize=False)),
                ("request_id", models.CharField(max_length=120, unique=True)),
                ("applied_amount", models.DecimalField(decimal_places=2, max_digits=12)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("order", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="deposit_refund_requests", to="core.order")),
            ],
            options={"db_table": "OrderDepositRefundRequest"},
        ),
    ]
