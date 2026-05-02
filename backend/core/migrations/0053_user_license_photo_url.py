from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0052_add_order_rescheduled_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="license_photo_url",
            field=models.TextField(blank=True, null=True),
        ),
    ]

