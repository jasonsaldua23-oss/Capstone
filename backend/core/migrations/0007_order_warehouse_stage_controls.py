from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0006_savedroutedraft"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="warehouse_stage",
            field=models.CharField(
                choices=[
                    ("READY_TO_LOAD", "Ready To Load"),
                    ("LOADED", "Loaded"),
                    ("DISPATCHED", "Dispatched"),
                ],
                default="READY_TO_LOAD",
                max_length=50,
            ),
        ),
        migrations.AddField(model_name="order", name="ready_to_load_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="order", name="loaded_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="order", name="warehouse_dispatched_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="order", name="checklist_items_verified", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="order", name="checklist_quantity_verified", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="order", name="checklist_packaging_verified", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="order", name="checklist_vehicle_assigned", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="order", name="checklist_driver_assigned", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="order", name="dispatch_signed_off_by", field=models.CharField(blank=True, max_length=255, null=True)),
        migrations.AddField(model_name="order", name="dispatch_signed_off_user_id", field=models.CharField(blank=True, max_length=100, null=True)),
        migrations.AddField(model_name="order", name="dispatch_signed_off_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="order", name="exception_short_load_qty", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="order", name="exception_damaged_on_loading_qty", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="order", name="exception_hold_reason", field=models.TextField(blank=True, null=True)),
        migrations.AddField(model_name="order", name="exception_notes", field=models.TextField(blank=True, null=True)),
    ]
