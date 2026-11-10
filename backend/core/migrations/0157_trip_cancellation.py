from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0156_empties_stock_correction")]
    # Added: the warehouse cancels a trip instead of deleting it, so who, when and why are kept.
    operations = [
        migrations.AddField(model_name="trip", name="cancelled_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="trip", name="cancelled_by_user_id", field=models.CharField(blank=True, max_length=25, null=True)),
        migrations.AddField(model_name="trip", name="cancelled_by_name", field=models.CharField(blank=True, max_length=255, null=True)),
        migrations.AddField(model_name="trip", name="cancellation_reason", field=models.TextField(blank=True, null=True)),
    ]
