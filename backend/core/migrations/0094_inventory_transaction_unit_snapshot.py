from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0093_vehicle_choice_state")]

    operations = [
        migrations.AddField(
            model_name="inventorytransaction",
            name="stock_unit_label",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
    ]
