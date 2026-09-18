from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0123_sync_stamp"),
    ]

    operations = [
        migrations.AddField(
            model_name="feedback",
            name="comment",
            field=models.TextField(blank=True, default=""),
        ),
    ]
