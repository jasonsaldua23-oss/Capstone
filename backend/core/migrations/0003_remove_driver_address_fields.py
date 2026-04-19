from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_passwordresetotp"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="driver",
            name="address",
        ),
        migrations.RemoveField(
            model_name="driver",
            name="city",
        ),
        migrations.RemoveField(
            model_name="driver",
            name="province",
        ),
        migrations.RemoveField(
            model_name="driver",
            name="zip_code",
        ),
    ]

