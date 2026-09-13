from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0112_order_deposit_refund_claim_units")]
    # Added: retain token/OTP revocation across workers and process restarts.
    operations = [migrations.CreateModel(
        name="ConsumedAuthProof",
        fields=[
            ("digest", models.CharField(primary_key=True, max_length=64, serialize=False)),
            ("purpose", models.CharField(max_length=30)),
            ("expires_at", models.DateTimeField(db_index=True)),
        ],
        options={"db_table": "ConsumedAuthProof"},
    )]
