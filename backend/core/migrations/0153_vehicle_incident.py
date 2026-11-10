import core.models
import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0152_opening_empties_submission")]
    # Added: accidents and vehicle damage reported by drivers, shown on the live tracking maps.
    operations = [migrations.CreateModel(
        name="VehicleIncident",
        fields=[
            ("id", models.CharField(default=core.models.generate_cuid, editable=False, max_length=25, primary_key=True, serialize=False)),
            ("incident_number", models.CharField(max_length=120, unique=True)),
            ("request_id", models.CharField(max_length=120)),
            ("type", models.CharField(choices=[("ACCIDENT", "Accident"), ("VEHICLE_DAMAGE", "Vehicle damage")], max_length=30)),
            ("vehicle_can_continue", models.BooleanField(default=False)),
            ("description", models.TextField()),
            ("photo_url", models.CharField(blank=True, default="", max_length=500)),
            ("latitude", models.FloatField(blank=True, null=True)),
            ("longitude", models.FloatField(blank=True, null=True)),
            ("location_accuracy", models.FloatField(blank=True, null=True)),
            ("location_source", models.CharField(blank=True, choices=[("DEVICE", "Driver's device when reporting"), ("LAST_GPS", "Driver's last GPS update")], default="", max_length=20)),
            ("location_recorded_at", models.DateTimeField(blank=True, null=True)),
            ("status", models.CharField(choices=[("REPORTED", "Reported"), ("ACKNOWLEDGED", "Acknowledged"), ("RESOLVED", "Resolved")], default="REPORTED", max_length=20)),
            ("acknowledged_at", models.DateTimeField(blank=True, null=True)),
            ("resolved_at", models.DateTimeField(blank=True, null=True)),
            ("resolution_outcome", models.CharField(blank=True, choices=[("RESUMED", "Vehicle resumed the trip"), ("SENT_FOR_REPAIR", "Vehicle sent for repair")], default="", max_length=30)),
            ("resolution_notes", models.TextField(blank=True, default="")),
            ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
            ("updated_at", models.DateTimeField(auto_now=True)),
            ("acknowledged_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="acknowledged_vehicle_incidents", to="core.user")),
            ("driver", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="vehicle_incidents", to="core.user")),
            ("resolved_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="resolved_vehicle_incidents", to="core.user")),
            ("trip", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="incidents", to="core.trip")),
            ("vehicle", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="incidents", to="core.vehicle")),
        ],
        options={
            "db_table": "VehicleIncident",
            "indexes": [models.Index(fields=["status", "created_at"], name="vehicle_incident_status_time")],
            "constraints": [
                models.UniqueConstraint(fields=("driver", "request_id"), name="unique_vehicle_incident_request"),
                models.UniqueConstraint(
                    condition=models.Q(("status__in", ["REPORTED", "ACKNOWLEDGED"])),
                    fields=("trip",),
                    name="unique_open_vehicle_incident_per_trip",
                ),
            ],
        },
    )]
