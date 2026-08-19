from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0072_alter_order_status"),
    ]

    operations = [
        migrations.RunPython(
            code=lambda apps, schema_editor: schema_editor.connection.cursor().execute('ALTER TABLE "OrderItem" ALTER COLUMN "product_id" DROP NOT NULL;') if schema_editor.connection.vendor == 'postgresql' else None,
            reverse_code=lambda apps, schema_editor: schema_editor.connection.cursor().execute('ALTER TABLE "OrderItem" ALTER COLUMN "product_id" SET NOT NULL;') if schema_editor.connection.vendor == 'postgresql' else None,
        ),
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

