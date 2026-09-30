# Preserve existing balances while adding auditable opening declarations.
import core.models
import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0148_trip_path_point")]

    operations = [
        migrations.CreateModel(
            name="OpeningEmptiesDeclaration",
            fields=[
                ("id", models.CharField(default=core.models.generate_cuid, editable=False, max_length=25, primary_key=True, serialize=False)),
                ("request_id", models.CharField(max_length=120)),
                ("cases", models.PositiveIntegerField(default=0)),
                ("bottles", models.PositiveIntegerField(default=0)),
                ("containers_per_case", models.PositiveIntegerField(default=1)),
                ("remaining_bottles", models.PositiveIntegerField(default=0)),
                ("status", models.CharField(choices=[("PENDING", "Pending review"), ("APPROVED", "Approved"), ("REJECTED", "Rejected")], default="PENDING", max_length=20)),
                ("notes", models.TextField(blank=True, default="")),
                ("review_notes", models.TextField(blank=True, default="")),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("container_type", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="opening_empties", to="core.containertype")),
                ("customer", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="opening_empties", to="core.customer")),
                ("product", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="opening_empties", to="core.product")),
                ("reviewed_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="reviewed_opening_empties", to="core.user")),
            ],
            options={
                "db_table": "OpeningEmptiesDeclaration",
                "constraints": [
                    models.UniqueConstraint(fields=("customer", "request_id"), name="unique_opening_empties_request"),
                    models.UniqueConstraint(condition=models.Q(status__in=["PENDING", "APPROVED"]), fields=("customer", "product"), name="unique_active_opening_empties"),
                ],
            },
        ),
    ]
