from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

    def ready(self) -> None:
        # Added: register stock-level transition alerts for every inventory write path.
        from . import inventory_signals  # noqa: F401
