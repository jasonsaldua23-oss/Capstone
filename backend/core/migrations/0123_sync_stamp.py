from django.db import migrations, models


def seed_scopes(apps, schema_editor):
    """Create one row per known scope so the read path is a plain indexed lookup."""
    from core.sync_stamps import SYNC_SCOPES

    SyncStamp = apps.get_model("core", "SyncStamp")
    SyncStamp.objects.bulk_create(
        [SyncStamp(scope=scope, revision=0) for scope in SYNC_SCOPES],
        ignore_conflicts=True,
    )


def drop_scopes(apps, schema_editor):
    apps.get_model("core", "SyncStamp").objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0122_trip_request_id"),
    ]

    operations = [
        migrations.CreateModel(
            name="SyncStamp",
            fields=[
                ("scope", models.CharField(max_length=40, primary_key=True, serialize=False)),
                ("revision", models.BigIntegerField(default=0)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Sync Stamp",
                "verbose_name_plural": "Sync Stamps",
                "db_table": "SyncStamp",
            },
        ),
        migrations.RunPython(seed_scopes, drop_scopes),
    ]
