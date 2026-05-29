from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0074_product_category_field"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="two_factor_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="user",
            name="login_alerts_enabled",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="user",
            name="session_timeout_minutes",
            field=models.IntegerField(default=30),
        ),
    ]

