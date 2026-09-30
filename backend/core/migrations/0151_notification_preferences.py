from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0150_opening_empties_evidence_photo")]
    operations = [
        # Persist per-account choices without changing existing notification history.
        migrations.AddField(model_name="customer", name="notification_preferences", field=models.JSONField(blank=True, default=dict)),
        migrations.AddField(model_name="user", name="notification_preferences", field=models.JSONField(blank=True, default=dict)),
    ]
