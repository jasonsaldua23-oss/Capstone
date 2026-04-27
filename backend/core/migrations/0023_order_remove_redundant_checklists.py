from django.db import migrations


def merge_redundant_checklists_into_quantity(apps, schema_editor):
    Order = apps.get_model("core", "Order")
    for order in Order.objects.all().only(
        "id",
        "checklist_quantity_verified",
        "checklist_items_verified",
        "checklist_packaging_verified",
        "checklist_spare_products_verified",
        "checklist_vehicle_assigned",
        "checklist_driver_assigned",
    ):
        merged_value = bool(
            order.checklist_quantity_verified
            or order.checklist_items_verified
            or order.checklist_packaging_verified
            or order.checklist_spare_products_verified
            or order.checklist_vehicle_assigned
            or order.checklist_driver_assigned
        )
        if bool(order.checklist_quantity_verified) != merged_value:
            order.checklist_quantity_verified = merged_value
            order.save(update_fields=["checklist_quantity_verified"])


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0022_paymentcheckoutdraft"),
    ]

    operations = [
        migrations.RunPython(merge_redundant_checklists_into_quantity, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="order",
            name="checklist_items_verified",
        ),
        migrations.RemoveField(
            model_name="order",
            name="checklist_packaging_verified",
        ),
        migrations.RemoveField(
            model_name="order",
            name="checklist_spare_products_verified",
        ),
        migrations.RemoveField(
            model_name="order",
            name="checklist_vehicle_assigned",
        ),
        migrations.RemoveField(
            model_name="order",
            name="checklist_driver_assigned",
        ),
    ]
