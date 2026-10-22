from __future__ import annotations

import importlib
import shutil
import tempfile
from pathlib import Path

from django.core.checks import Error
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import clear_url_caches

from config import env
from config.checks import check_production_launch_guards

HEX64 = "a" * 64


class EnvHelperTests(SimpleTestCase):
    def test_normalize_env(self):
        self.assertEqual(env.normalize_env("PROD"), "production")
        self.assertEqual(env.normalize_env("stage"), "staging")
        self.assertEqual(env.normalize_env(None), "development")
        self.assertEqual(env.normalize_env("weird"), "development")

    def test_secret_key_required_in_staging_and_production(self):
        for name in ("staging", "production"):
            with self.assertRaises(RuntimeError):
                env.resolve_secret_key(name, {})
        self.assertEqual(env.resolve_secret_key("staging", {"DJANGO_SECRET_KEY": "s3cret"}), "s3cret")
        self.assertEqual(env.resolve_secret_key("production", {"SECRET_KEY": "k"}), "k")
        self.assertEqual(env.resolve_secret_key("development", {}), env.DEV_SECRET_KEY)

    def test_code_encryption_key_required_in_staging(self):
        for name in ("staging", "production"):
            with self.assertRaises(RuntimeError):
                env.resolve_code_encryption_key(name, {})
            with self.assertRaises(RuntimeError):
                env.resolve_code_encryption_key(name, {"CODE_ENCRYPTION_KEY": "z" * 64})
            self.assertEqual(env.resolve_code_encryption_key(name, {"CODE_ENCRYPTION_KEY": HEX64}), HEX64)
        self.assertEqual(env.resolve_code_encryption_key("development", {}), "")

    def test_email_settings(self):
        console = env.email_settings({})
        self.assertEqual(console["EMAIL_BACKEND"], "django.core.mail.backends.console.EmailBackend")
        self.assertFalse(console["EMAIL_CONFIGURED"])
        self.assertEqual(console["DEFAULT_FROM_EMAIL"], "MMH <no-reply@mmhcard.com>")
        smtp = env.email_settings(
            {"EMAIL_HOST": "smtp.example.com", "EMAIL_HOST_USER": "u", "EMAIL_HOST_PASSWORD": "p"}
        )
        self.assertEqual(smtp["EMAIL_BACKEND"], "django.core.mail.backends.smtp.EmailBackend")
        self.assertEqual(smtp["EMAIL_PORT"], 587)
        self.assertTrue(smtp["EMAIL_USE_TLS"])
        self.assertFalse(smtp["EMAIL_USE_SSL"])
        ssl = env.email_settings({"EMAIL_HOST": "smtp.example.com", "EMAIL_USE_SSL": "true"})
        self.assertEqual(ssl["EMAIL_PORT"], 465)
        self.assertTrue(ssl["EMAIL_USE_SSL"])
        self.assertFalse(ssl["EMAIL_USE_TLS"])


class LaunchGuardTests(SimpleTestCase):
    @override_settings(IS_PRODUCTION=False, IS_STAGING=True, IS_DEVELOPMENT=False, DEBUG=True)
    def test_staging_runs_deploy_guards(self):
        ids = {m.id for m in check_production_launch_guards(None) if isinstance(m, Error)}
        self.assertIn("config.E001", ids)

    @override_settings(IS_PRODUCTION=False, IS_STAGING=False, IS_DEVELOPMENT=True, DEBUG=True)
    def test_development_skips_deploy_guards(self):
        ids = {m.id for m in check_production_launch_guards(None) if isinstance(m, Error)}
        self.assertNotIn("config.E001", ids)


class MediaServingTests(TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="mmh-media-"))
        (self.root / "uploads").mkdir()
        (self.root / "code_imports").mkdir()
        (self.root / "uploads" / "img.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
        (self.root / "code_imports" / "batch.csv").write_text("code\nSECRET-1\n")
        self.override = override_settings(MEDIA_ROOT=self.root)
        self.override.enable()

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.root, ignore_errors=True)

    def test_serves_uploaded_media_with_cache_headers(self):
        res = self.client.get("/media/uploads/img.png")
        self.assertEqual(res.status_code, 200)
        cache_control = res["Cache-Control"]
        self.assertIn("public", cache_control)
        self.assertIn("max-age=", cache_control)
        self.assertEqual(res["X-Content-Type-Options"], "nosniff")

    @override_settings(DEBUG=False)
    def test_served_without_debug(self):
        self.assertEqual(self.client.get("/media/uploads/img.png").status_code, 200)

    def test_code_imports_are_never_served(self):
        self.assertEqual(self.client.get("/media/code_imports/batch.csv").status_code, 404)
        self.assertEqual(self.client.get("/media/CODE_IMPORTS/batch.csv").status_code, 404)
        self.assertEqual(self.client.get("/media/uploads/../code_imports/batch.csv").status_code, 404)
        self.assertEqual(self.client.get("/media/code_imports/").status_code, 404)

    def test_missing_and_traversal_404(self):
        self.assertEqual(self.client.get("/media/uploads/missing.png").status_code, 404)
        self.assertEqual(self.client.get("/media/../manage.py").status_code, 404)


class DjangoAdminToggleTests(SimpleTestCase):
    def _reload(self):
        import config.urls

        clear_url_caches()
        return importlib.reload(config.urls)

    def _has_admin(self, module) -> bool:
        return any(str(p.pattern) == "django-admin/" for p in module.urlpatterns)

    def test_toggle(self):
        try:
            with override_settings(DJANGO_ADMIN_ENABLED=False):
                self.assertFalse(self._has_admin(self._reload()))
            with override_settings(DJANGO_ADMIN_ENABLED=True):
                self.assertTrue(self._has_admin(self._reload()))
        finally:
            self._reload()


class HealthTests(SimpleTestCase):
    def test_health(self):
        self.assertEqual(self.client.get("/api/health/").status_code, 200)
