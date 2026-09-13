"""Disposable settings for migration drift checks; never use to serve the application."""

from .settings_ci import *  # noqa: F401,F403

# Test execution bypasses migrations for speed. This check restores discovery so
# `makemigrations --check --dry-run` validates the committed migration graph.
MIGRATION_MODULES = {}
