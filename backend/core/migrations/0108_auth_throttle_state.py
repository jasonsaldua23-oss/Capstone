from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [("core", "0107_inventory_transaction_performed_by")]

    operations = [
        migrations.CreateModel(
            name="AuthThrottleState",
            fields=[
                ("key", models.CharField(editable=False, max_length=64, primary_key=True, serialize=False)),
                ("action", models.CharField(max_length=50)),
                ("scope", models.CharField(max_length=16)),
                ("identifier_hash", models.CharField(max_length=64)),
                ("attempt_count", models.PositiveIntegerField(default=0)),
                ("window_started_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("last_attempt_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("blocked_until", models.DateTimeField(blank=True, null=True)),
                ("alert_sent_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={
                "db_table": "AuthThrottleState",
                "indexes": [
                    models.Index(
                        fields=["action", "scope", "last_attempt_at"],
                        name="auth_throttle_lookup_idx",
                    )
                ],
            },
        ),
    ]
