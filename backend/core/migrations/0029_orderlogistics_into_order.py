from django.db import migrations, models


def _copy_order_logistics_into_order(apps, schema_editor):
    Order = apps.get_model("core", "Order")
    OrderLogistics = apps.get_model("core", "OrderLogistics")

    for log in OrderLogistics.objects.all().iterator():
        Order.objects.filter(id=log.order_id).update(
            shipping_name=log.shipping_name,
            shipping_phone=log.shipping_phone,
            shipping_address=log.shipping_address,
            shipping_city=log.shipping_city,
            shipping_province=log.shipping_province,
            shipping_zip_code=log.shipping_zip_code,
            shipping_country=log.shipping_country or "Philippines",
            shipping_latitude=log.shipping_latitude,
            shipping_longitude=log.shipping_longitude,
            notes=log.notes,
            special_instructions=log.special_instructions,
        )


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0028_delete_auditlog"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="notes",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="shipping_address",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="shipping_city",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="shipping_country",
            field=models.CharField(default="Philippines", max_length=100),
        ),
        migrations.AddField(
            model_name="order",
            name="shipping_latitude",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="shipping_longitude",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="shipping_name",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="shipping_phone",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="shipping_province",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="shipping_zip_code",
            field=models.CharField(blank=True, max_length=20, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="special_instructions",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.RunPython(_copy_order_logistics_into_order, migrations.RunPython.noop),
        migrations.DeleteModel(
            name="OrderLogistics",
        ),
    ]

