from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0098_remove_inventorytransaction_performed_by")]

    operations = [
        migrations.AddField(
            model_name="customer",
            name="two_factor_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="customer",
            name="login_alerts_enabled",
            field=models.BooleanField(default=True),
        ),
    ]
