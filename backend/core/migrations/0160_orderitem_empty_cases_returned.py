from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0159_incident_trip_ended_outcome'),
    ]

    operations = [
        migrations.AddField(
            model_name='orderitem',
            name='empty_cases_returned',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
