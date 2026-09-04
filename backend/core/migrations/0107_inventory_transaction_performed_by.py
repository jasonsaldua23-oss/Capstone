from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0106_add_user_driver_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="inventorytransaction",
            name="performed_by",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
    ]
