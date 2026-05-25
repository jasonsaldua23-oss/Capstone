from urllib.parse import quote

from django.test import SimpleTestCase

from config import settings as project_settings


class DatabaseUrlParsingTests(SimpleTestCase):
    def test_pooler_url_defaults_to_require_without_sslrootcert(self) -> None:
        config = project_settings._parse_database_url(
            "postgresql://user:pass@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
        )

        self.assertEqual(config["OPTIONS"]["sslmode"], "require")
        self.assertNotIn("sslrootcert", config["OPTIONS"])

    def test_verify_full_uses_cert_bundle_when_available(self) -> None:
        config = project_settings._parse_database_url(
            "postgresql://user:pass@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full"
        )

        self.assertEqual(config["OPTIONS"]["sslmode"], "verify-full")
        if project_settings.certifi is None:
            self.assertNotIn("sslrootcert", config["OPTIONS"])
        else:
            self.assertEqual(config["OPTIONS"]["sslrootcert"], project_settings.certifi.where())

    def test_explicit_sslrootcert_is_preserved(self) -> None:
        sslrootcert = "/etc/ssl/certs/prod-supabase.cer"
        config = project_settings._parse_database_url(
            "postgresql://user:pass@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
            f"?sslmode=verify-full&sslrootcert={quote(sslrootcert, safe='')}"
        )

        self.assertEqual(config["OPTIONS"]["sslrootcert"], sslrootcert)

    def test_pooler_runtime_url_is_normalized_to_5432(self) -> None:
        normalized = project_settings._normalize_runtime_database_url(
            "postgresql://user:pass@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres"
        )

        self.assertEqual(
            normalized,
            "postgresql://user:pass@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres",
        )
