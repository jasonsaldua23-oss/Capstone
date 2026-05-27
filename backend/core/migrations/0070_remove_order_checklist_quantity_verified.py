from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0069_remove_warehousestaffassignment"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="order",
            name="checklist_quantity_verified",
        ),
    ]

