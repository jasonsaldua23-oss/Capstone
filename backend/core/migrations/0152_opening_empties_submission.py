# Products declared in one submission share an id so staff review them as one declaration.
from datetime import timedelta

from django.db import migrations, models


def group_existing_rows(apps, schema_editor):
    # Rows saved before this field existed: one customer's rows created within a few
    # seconds of each other came from a single submission.
    Declaration = apps.get_model("core", "OpeningEmptiesDeclaration")
    previous = None
    for row in Declaration.objects.order_by("customer_id", "created_at", "id"):
        same_submission = (
            previous is not None
            and previous.customer_id == row.customer_id
            and row.created_at - previous.created_at <= timedelta(seconds=5)
        )
        row.submission_id = previous.submission_id if same_submission else row.id
        row.save(update_fields=["submission_id"])
        previous = row


class Migration(migrations.Migration):
    dependencies = [("core", "0151_notification_preferences")]

    operations = [
        migrations.AddField(
            model_name="openingemptiesdeclaration",
            name="submission_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=25),
        ),
        migrations.RunPython(group_existing_rows, migrations.RunPython.noop),
    ]
