import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0157_trip_cancellation")]
    # Added: a truck that cannot go on hands its undelivered stops to another truck.
    operations = [
        migrations.AddField(
            model_name="trip", name="transferred_from",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="load_transfers", to="core.trip"),
        ),
        migrations.AddField(model_name="trip", name="transferred_from_number", field=models.CharField(blank=True, max_length=120, null=True)),
        migrations.AddField(model_name="trip", name="transferred_to_number", field=models.CharField(blank=True, max_length=120, null=True)),
        migrations.AddField(model_name="trip", name="transferred_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="trip", name="transfer_reason", field=models.TextField(blank=True, null=True)),
        migrations.AddField(model_name="trip", name="transfer_latitude", field=models.FloatField(blank=True, null=True)),
        migrations.AddField(model_name="trip", name="transfer_longitude", field=models.FloatField(blank=True, null=True)),
    ]
