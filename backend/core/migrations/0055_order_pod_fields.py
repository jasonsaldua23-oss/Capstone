from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0054_replacement_damage_photo_urls"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="pod_photo_url",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="pod_recipient_name",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="pod_submitted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
