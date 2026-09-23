import json

from django.db import migrations


def _replace_metadata_number(notes, replacement_number):
    raw_notes = str(notes or "")
    marker = "Meta:"
    marker_index = raw_notes.rfind(marker)
    if marker_index < 0:
        return raw_notes
    prefix = raw_notes[:marker_index].rstrip()
    payload = raw_notes[marker_index + len(marker):].strip()
    try:
        metadata, _ = json.JSONDecoder().raw_decode(payload)
    except (TypeError, ValueError):
        return raw_notes
    if not isinstance(metadata, dict):
        return raw_notes
    metadata["replacementOrderNumber"] = replacement_number
    encoded = json.dumps(metadata)
    return f"{prefix}\nMeta: {encoded}" if prefix else f"Meta: {encoded}"


def reuse_replacement_number_for_delivery(apps, schema_editor):
    """Give every linked delivery the number of its owning replacement case."""
    Order = apps.get_model("core", "Order")
    Replacement = apps.get_model("core", "Replacement")
    replacements = list(
        Replacement.objects.exclude(delivery_transaction_id=None).only(
            "id", "replacement_number", "delivery_transaction_id", "notes"
        )
    )
    linked_order_ids = {row.delivery_transaction_id for row in replacements}
    target_numbers = {row.replacement_number for row in replacements}
    collision = Order.objects.filter(order_number__in=target_numbers).exclude(id__in=linked_order_ids).first()
    if collision:
        raise RuntimeError(
            f"Order {collision.id} already uses a replacement number; reconcile it before migration."
        )

    # Temporary values avoid unique-key collisions when legacy numbers are swapped.
    for row in replacements:
        Order.objects.filter(id=row.delivery_transaction_id).update(
            order_number=f"TMP-RPL-{row.delivery_transaction_id}"
        )
    for row in replacements:
        Order.objects.filter(id=row.delivery_transaction_id).update(
            order_number=row.replacement_number
        )
        updated_notes = _replace_metadata_number(row.notes, row.replacement_number)
        if updated_notes != row.notes:
            Replacement.objects.filter(id=row.id).update(notes=updated_notes)


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0136_close_replacements_with_closed_deliveries"),
    ]

    operations = [
        migrations.RunPython(reuse_replacement_number_for_delivery, migrations.RunPython.noop),
    ]
