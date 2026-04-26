from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0018_rename_return_to_replacement"),
    ]

    operations = [
        migrations.RunSQL(
            sql='ALTER TABLE "Replacement" ADD COLUMN IF NOT EXISTS "pickup_completed" timestamp with time zone NULL;',
            reverse_sql='ALTER TABLE "Replacement" DROP COLUMN IF EXISTS "pickup_completed";',
        ),
    ]

