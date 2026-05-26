from django.contrib.staticfiles.management.commands.runserver import Command as StaticFilesRunserverCommand


class Command(StaticFilesRunserverCommand):
    # The live Supabase schema is managed over HTTPS when local Postgres sockets
    # are blocked, so don't fail dev-server startup on Django's migration probe.
    requires_migrations_checks = False

    def check_migrations(self) -> None:
        return None
