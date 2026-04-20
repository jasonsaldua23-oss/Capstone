from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone
import core.models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0005_remove_vehicle_make_model_year_fuel_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="SavedRouteDraft",
            fields=[
                ("id", models.CharField(default=core.models.generate_cuid, editable=False, max_length=25, primary_key=True, serialize=False)),
                ("date", models.DateField()),
                ("warehouse_id", models.CharField(max_length=25)),
                ("warehouse_name", models.CharField(max_length=255)),
                ("city", models.CharField(max_length=100)),
                ("total_distance_km", models.FloatField(default=0)),
                ("order_ids", models.JSONField(default=list)),
                ("orders_json", models.JSONField(default=list)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "created_by_user",
                    models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="saved_route_drafts", to="core.user"),
                ),
            ],
            options={
                "db_table": "SavedRouteDraft",
            },
        ),
        migrations.AddIndex(
            model_name="savedroutedraft",
            index=models.Index(fields=["date", "warehouse_id"], name="SavedRouteD_date_87fdf9_idx"),
        ),
        migrations.AddIndex(
            model_name="savedroutedraft",
            index=models.Index(fields=["created_by_user", "created_at"], name="SavedRouteD_created_ad7989_idx"),
        ),
    ]
