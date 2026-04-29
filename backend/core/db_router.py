import os


class CoreAppRouter:
    """
    Optional router for pinning all `core` app models to a chosen DB alias.

    Enable with:
    - ENABLE_CORE_DB_ROUTER=1
    - CORE_DB_ALIAS=supabase | local_sqlite | default
    """

    def __init__(self) -> None:
        self.enabled = str(os.getenv("ENABLE_CORE_DB_ROUTER", "0")).strip().lower() in {"1", "true", "yes", "on"}
        self.alias = str(os.getenv("CORE_DB_ALIAS", "default")).strip() or "default"

    def db_for_read(self, model, **hints):
        if self.enabled and model._meta.app_label == "core":
            return self.alias
        return None

    def db_for_write(self, model, **hints):
        if self.enabled and model._meta.app_label == "core":
            return self.alias
        return None

    def allow_relation(self, obj1, obj2, **hints):
        if not self.enabled:
            return None
        if obj1._meta.app_label == "core" or obj2._meta.app_label == "core":
            return obj1._state.db == obj2._state.db
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if not self.enabled:
            return None
        if app_label == "core":
            return db == self.alias
        return None
