from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0076_remove_user_license_photo_url"),
    ]

    operations = [
        migrations.AlterField(
            model_name="user",
            name="license_type",
            field=models.CharField(blank=True, max_length=30, null=True),
        ),
    ]
