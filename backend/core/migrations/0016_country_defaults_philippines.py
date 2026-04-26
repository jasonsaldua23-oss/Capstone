from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0015_user_email_not_unique"),
    ]

    operations = [
        migrations.AlterField(
            model_name="customer",
            name="country",
            field=models.CharField(default="Philippines", max_length=100),
        ),
        migrations.AlterField(
            model_name="warehouse",
            name="country",
            field=models.CharField(default="Philippines", max_length=100),
        ),
        migrations.AlterField(
            model_name="orderlogistics",
            name="shipping_country",
            field=models.CharField(default="Philippines", max_length=100),
        ),
    ]
