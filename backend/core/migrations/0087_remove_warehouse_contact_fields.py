from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0086_rgb_new_models'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='warehouse',
            name='contact_name',
        ),
        migrations.RemoveField(
            model_name='warehouse',
            name='contact_email',
        ),
        migrations.RemoveField(
            model_name='warehouse',
            name='contact_phone',
        ),
    ]
