"""The separate owner tier was merged into Admin by migration 0144."""

from importlib import import_module
from types import SimpleNamespace

from django.apps import apps
from django.db import connection
from django.test import TestCase

from .models import RoleType, User

merge_migration = import_module("core.migrations.0144_merge_super_admin_into_admin")


class AdminRoleMergeMigrationTests(TestCase):
    def test_legacy_owner_accounts_become_admins_and_other_roles_are_untouched(self):
        # The legacy value is written directly: the model no longer offers it.
        owner = User.objects.create(name="Owner", email="owner@merge.invalid", role=merge_migration.LEGACY_OWNER_ROLE)
        driver = User.objects.create(name="Driver", email="driver@merge.invalid", role=RoleType.DRIVER)

        merge_migration.merge_owner_into_admin(apps, SimpleNamespace(connection=connection))

        owner.refresh_from_db()
        driver.refresh_from_db()
        self.assertEqual(owner.role, RoleType.ADMIN)
        self.assertEqual(driver.role, RoleType.DRIVER)
        self.assertFalse(User.objects.filter(role=merge_migration.LEGACY_OWNER_ROLE).exists())
