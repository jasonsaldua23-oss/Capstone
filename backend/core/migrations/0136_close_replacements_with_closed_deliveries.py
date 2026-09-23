from django.db import migrations
from django.utils import timezone


def close_replacements_with_closed_deliveries(apps, schema_editor):
    """Align stale replacement requests with their authoritative closed delivery."""
    Replacement = apps.get_model("core", "Replacement")
    Replacement.objects.filter(
        delivery_transaction__status__in=["CANCELLED", "REJECTED"]
    ).exclude(
        status__in=["CANCELLED", "COMPLETED"]
    ).update(status="CANCELLED", updated_at=timezone.now())


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0135_remove_legacy_packaging_profiles"),
    ]

    operations = [
        migrations.RunPython(close_replacements_with_closed_deliveries, migrations.RunPython.noop),
    ]
