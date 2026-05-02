from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0053_user_license_photo_url"),
    ]

    operations = [
        migrations.AddField(
            model_name="replacement",
            name="damage_photo_urls",
            field=models.TextField(blank=True, null=True),
        ),
    ]
