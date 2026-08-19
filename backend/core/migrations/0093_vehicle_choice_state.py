"""Keep the existing vehicle choice validation represented in migration state."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0092_retail_pos_walk_in_support"),
    ]

    operations = [
        migrations.AlterField(
            model_name="vehicle",
            name="classification",
            field=models.CharField(choices=[("LIGHT_DUTY", "Light-Duty"), ("MEDIUM_DUTY", "Medium-Duty"), ("HEAVY_DUTY", "Heavy-Duty")], default="LIGHT_DUTY", max_length=50),
        ),
        migrations.AlterField(
            model_name="vehicle",
            name="type",
            field=models.CharField(choices=[("TRUCK", "Truck"), ("TRICYCLE", "Tricycle"), ("VAN", "Van"), ("MOTORCYCLE", "Motorcycle"), ("CAR", "Car")], default="TRUCK", max_length=50),
        ),
    ]
