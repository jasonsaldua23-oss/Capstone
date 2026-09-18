from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0124_feedback_comment"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="feedback",
            name="comment",
        ),
    ]
