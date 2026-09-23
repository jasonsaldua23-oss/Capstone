from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

    def ready(self) -> None:
        # Added: register stock-level transition alerts for every inventory write path.
        from . import inventory_signals  # noqa: F401
        # Purchase documents follow transaction writes, including admin and seed paths.
        from . import purchase_documents  # noqa: F401

        # Advance the cross-device sync stamps whenever watched records change.
        from .sync_stamps import register_signals

        register_signals()
