from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0088_glass_deposit_configuration"),
    ]

    operations = [
        migrations.AddField(
            model_name="vehicle",
            name="brand",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AddField(
            model_name="vehicle",
            name="model",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AddField(
            model_name="vehicle",
            name="year",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="vehicle",
            name="classification",
            field=models.CharField(blank=True, default="LIGHT_DUTY", max_length=50),
        ),
    ]
