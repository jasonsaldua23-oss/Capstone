from django.db import migrations, models
import django.db.models.deletion


def backfill_orderitem_product_snapshot(apps, schema_editor):
    OrderItem = apps.get_model("core", "OrderItem")
    Product = apps.get_model("core", "Product")

    product_ids = set(
        str(pid).strip()
        for pid in OrderItem.objects.exclude(product_id__isnull=True).values_list("product_id", flat=True)
        if str(pid).strip()
    )
    if not product_ids:
        return

    products = {
        str(product.id): product
        for product in Product.objects.filter(id__in=product_ids).only("id", "name", "sku", "unit")
    }

    for item in OrderItem.objects.filter(product_id__isnull=False).iterator():
        product = products.get(str(item.product_id))
        if not product:
            continue
        updates = {}
        if not getattr(item, "product_name", None):
            updates["product_name"] = str(getattr(product, "name", "") or "").strip() or None
        if not getattr(item, "product_sku", None):
            updates["product_sku"] = str(getattr(product, "sku", "") or "").strip() or None
        if not getattr(item, "product_unit", None):
            updates["product_unit"] = str(getattr(product, "unit", "") or "").strip() or None
        if updates:
            OrderItem.objects.filter(id=item.id).update(**updates)


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0056_alter_feedback_customer_alter_feedback_message_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="orderitem",
            name="product_name",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name="orderitem",
            name="product_sku",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AddField(
            model_name="orderitem",
            name="product_unit",
            field=models.CharField(blank=True, max_length=50, null=True),
        ),
        migrations.RunPython(backfill_orderitem_product_snapshot, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="orderitem",
            name="product",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="order_items",
                to="core.product",
            ),
        ),
    ]

