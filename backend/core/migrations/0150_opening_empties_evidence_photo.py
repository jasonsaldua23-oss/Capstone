# Each existing-empties declaration carries one photo for staff verification.
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0149_opening_empties_declaration")]

    operations = [
        migrations.AddField(
            model_name="openingemptiesdeclaration",
            name="evidence_photo_url",
            field=models.CharField(blank=True, default="", max_length=500),
        ),
    ]
