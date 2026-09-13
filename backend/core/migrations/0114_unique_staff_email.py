from django.db import migrations, models
from django.db.models.functions import Lower


class Migration(migrations.Migration):
    dependencies = [("core", "0113_consumed_auth_proof")]
    # Intentionally fails on existing duplicates; never delete or merge account data silently.
    operations = [migrations.AddConstraint(
        model_name="user",
        constraint=models.UniqueConstraint(Lower("email"), name="unique_staff_email_normalized"),
    )]
