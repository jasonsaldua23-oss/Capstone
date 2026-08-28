from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone

import core.models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0102_restore_user_license_photo_url"),
    ]

    operations = [
        migrations.CreateModel(
            name="PushSubscription",
            fields=[
                ("id", models.CharField(default=core.models.generate_cuid, editable=False, max_length=25, primary_key=True, serialize=False)),
                ("endpoint", models.TextField()),
                ("p256dh", models.TextField()),
                ("auth", models.TextField()),
                ("user_agent", models.TextField(blank=True, null=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("customer", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="push_subscriptions", to="core.customer")),
                ("user", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="push_subscriptions", to="core.user")),
            ],
            options={"db_table": "PushSubscription"},
        ),
        migrations.AddConstraint(
            model_name="pushsubscription",
            constraint=models.CheckConstraint(
                check=(
                    models.Q(("customer__isnull", True), ("user__isnull", False))
                    | models.Q(("customer__isnull", False), ("user__isnull", True))
                ),
                name="push_subscription_has_one_owner",
            ),
        ),
        migrations.AddConstraint(
            model_name="pushsubscription",
            constraint=models.UniqueConstraint(fields=("endpoint", "user"), name="unique_push_endpoint_user"),
        ),
        migrations.AddConstraint(
            model_name="pushsubscription",
            constraint=models.UniqueConstraint(fields=("endpoint", "customer"), name="unique_push_endpoint_customer"),
        ),
    ]
