from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0101_rename_retail_sales_channel_label"),
    ]

    operations = [
        # Added: restore persisted driver-license uploads removed by migration 0076.
        migrations.AddField(
            model_name="user",
            name="license_photo_url",
            field=models.TextField(blank=True, null=True),
        ),
    ]
