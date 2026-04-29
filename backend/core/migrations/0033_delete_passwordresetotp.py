from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0032_remove_product_category"),
    ]

    operations = [
        migrations.DeleteModel(
            name="PasswordResetOTP",
        ),
    ]
