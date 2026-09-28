import core.models
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0147_session_activity")]
    # Added: the road a driver actually took during a trip, for the "path taken" line.
    operations = [migrations.CreateModel(
        name="TripPathPoint",
        fields=[
            ("id", models.CharField(default=core.models.generate_cuid, editable=False, max_length=25, primary_key=True, serialize=False)),
            ("latitude", models.FloatField()),
            ("longitude", models.FloatField()),
            ("accuracy", models.FloatField(blank=True, null=True)),
            ("speed", models.FloatField(blank=True, help_text="GPS speed in m/s", null=True)),
            ("recorded_at", models.DateTimeField()),
            ("trip", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="path_points", to="core.trip")),
        ],
        options={
            "db_table": "TripPathPoint",
            "indexes": [models.Index(fields=["trip", "recorded_at"], name="trip_path_point_trip_time")],
        },
    )]
