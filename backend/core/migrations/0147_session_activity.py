from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0146_rename_active_stock_batch_status_to_healthy")]
    # Added: server-enforced idle logout for web sessions without "Keep me logged in".
    operations = [migrations.CreateModel(
        name="SessionActivity",
        fields=[
            ("jti", models.CharField(primary_key=True, max_length=64, serialize=False)),
            ("last_active_at", models.DateTimeField()),
            ("expires_at", models.DateTimeField(db_index=True)),
        ],
        options={"db_table": "SessionActivity"},
    )]
