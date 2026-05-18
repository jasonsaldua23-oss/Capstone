from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone
import core.models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0060_customer_discount_policy_and_order_discount_metadata"),
    ]

    operations = [
        migrations.CreateModel(
            name="WarehouseStaffAssignment",
            fields=[
                ("id", models.CharField(default=core.models.generate_cuid, editable=False, max_length=25, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="warehouse_assignments", to="core.user")),
                ("warehouse", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="staff_assignments", to="core.warehouse")),
            ],
            options={
                "db_table": "WarehouseStaffAssignment",
            },
        ),
        migrations.AddConstraint(
            model_name="warehousestaffassignment",
            constraint=models.UniqueConstraint(fields=("warehouse", "user"), name="unique_warehouse_staff_assignment"),
        ),
    ]

