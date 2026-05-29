from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0072_alter_order_status"),
    ]

    operations = [
        migrations.RunSQL(
            sql='ALTER TABLE "OrderItem" ALTER COLUMN "product_id" DROP NOT NULL;',
            reverse_sql='ALTER TABLE "OrderItem" ALTER COLUMN "product_id" SET NOT NULL;',
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

