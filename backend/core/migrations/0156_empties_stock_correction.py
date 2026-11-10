import core.models
import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0155_feedback_rating_target")]
    # Added: incomplete empties returns adjust the warehouse's empty stock by what arrived.
    operations = [migrations.CreateModel(
        name="EmptiesStockCorrection",
        fields=[
            ("id", models.CharField(default=core.models.generate_cuid, editable=False, max_length=25, primary_key=True, serialize=False)),
            ("declared_bottles", models.PositiveIntegerField(default=0)),
            ("counted_bottles", models.PositiveIntegerField(default=0)),
            ("bottles", models.IntegerField()),
            ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
            ("bottle_return", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="stock_corrections", to="core.bottlereturn")),
            ("order", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="empties_stock_corrections", to="core.order")),
            ("product", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="empties_stock_corrections", to="core.product")),
        ],
        options={
            "db_table": "EmptiesStockCorrection",
            "constraints": [models.UniqueConstraint(fields=("bottle_return", "product"), name="unique_empties_correction_per_product")],
        },
    )]
