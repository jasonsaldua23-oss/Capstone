from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0003_remove_driver_address_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="driver",
            name="license_photo",
            field=models.TextField(blank=True, null=True),
        ),
    ]
