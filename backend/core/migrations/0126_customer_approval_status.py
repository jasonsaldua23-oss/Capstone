from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0125_remove_feedback_comment"),
    ]

    # Existing customers are backfilled as APPROVED by the column default, so no
    # one who could sign in before this migration loses access.
    operations = [
        migrations.AddField(
            model_name="customer",
            name="approval_status",
            field=models.CharField(
                choices=[
                    ("PENDING_APPROVAL", "Pending Approval"),
                    ("APPROVED", "Approved"),
                    ("REJECTED", "Rejected"),
                ],
                db_index=True,
                default="APPROVED",
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="customer",
            name="approval_reviewed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="customer",
            name="approval_reviewed_by_user_id",
            field=models.CharField(blank=True, max_length=25, null=True),
        ),
        migrations.AddField(
            model_name="customer",
            name="approval_reviewed_by_name",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name="customer",
            name="approval_notes",
            field=models.TextField(blank=True, null=True),
        ),
    ]
