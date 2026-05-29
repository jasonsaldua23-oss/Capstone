from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0075_user_security_settings"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="user",
            name="license_photo_url",
        ),
    ]

