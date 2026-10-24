"""Bulk digital-code inventory import tests — no external network calls."""

from __future__ import annotations

import csv
import io

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from audit.models import AuditLog
from catalog.models import (
    Category,
    FulfillmentType,
    Platform,
    Product,
    ProductKind,
    ProductVariant,
    PublishStatus,
    StockStatus,
)
from cms.models import SiteSettings
from commerce.crypto import decrypt_code, fingerprint_code, mask_code
from commerce.models import (
    CodeImportBatchStatus,
    DigitalCode,
    DigitalCodeSource,
    DigitalCodeStatus,
)


class CodeImportTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        SiteSettings.load()
        cls.admin = make_admin("import-admin@mmh.test", AdminRole.ADMIN)
        cls.viewer = make_admin("import-viewer@mmh.test", AdminRole.VIEWER)
        cls.catalog_mgr = make_admin("import-catalog@mmh.test", AdminRole.CATALOG_MANAGER)
        cls.order_mgr = make_admin("import-orders@mmh.test", AdminRole.ORDER_MANAGER)

        cls.category = Category.objects.create(slug="imp-cat", name_en="Imp", status=PublishStatus.PUBLISHED)
        cls.platform = Platform.objects.create(slug="imp-plat", name_en="Imp", status=PublishStatus.PUBLISHED)
        cls.product = Product.objects.create(
            id="imp-prod",
            slug="imp-prod",
            kind=ProductKind.GIFT_CARD,
            fulfillment_type=FulfillmentType.CODE,
            category=cls.category,
            platform=cls.platform,
            brand="Imp",
            artwork_key="imp",
            status=PublishStatus.PUBLISHED,
            name_en="Import Product",
        )
        cls.variant = ProductVariant.objects.create(
            product=cls.product,
            sku="PSN-10-US",
            denomination=10,
            package_value="10",
            package_currency="USD",
            price_fils=5000,
            stock_status=StockStatus.OUT_OF_STOCK,
            name_en="10 USD",
        )
        cls.variant_b = ProductVariant.objects.create(
            product=cls.product,
            sku="PSN-20-US",
            denomination=20,
            package_value="20",
            package_currency="USD",
            price_fils=9000,
            stock_status=StockStatus.OUT_OF_STOCK,
            name_en="20 USD",
        )

    def _csv(self, rows: list[list[str]], name: str = "codes.csv") -> SimpleUploadedFile:
        buf = io.StringIO()
        writer = csv.writer(buf)
        for row in rows:
            writer.writerow(row)
        return SimpleUploadedFile(name, buf.getvalue().encode("utf-8"), content_type="text/csv")

    def test_viewer_denied_preview(self):
        client = auth_client(self.viewer)
        f = self._csv([["code"], ["AAAA-BBBB-CCCC"]])
        res = client.post(
            "/api/v1/admin/codes/import/preview/",
            {"file": f, "mode": "SIMPLE", "variant_id": self.variant.id},
            format="multipart",
        )
        self.assertEqual(res.status_code, 403)

    def test_catalog_manager_denied_without_codes_manage(self):
        client = auth_client(self.catalog_mgr)
        f = self._csv([["code"], ["AAAA-BBBB-CCCC"]])
        res = client.post(
            "/api/v1/admin/codes/import/preview/",
            {"file": f, "mode": "SIMPLE", "variant_id": self.variant.id},
            format="multipart",
        )
        self.assertEqual(res.status_code, 403)

    def test_simple_csv_import_encrypts_and_fingerprints(self):
        client = auth_client(self.admin)
        f = self._csv([["code", "pin"], ["ABCD-EFGH-IJKL", "1234"], ["MNOP-QRST-UVWX", ""]])
        preview = client.post(
            "/api/v1/admin/codes/import/preview/",
            {"file": f, "mode": "SIMPLE", "variant_id": self.variant.id},
            format="multipart",
        )
        self.assertEqual(preview.status_code, 201, preview.content)
        batch = preview.json()["batch"]
        self.assertEqual(batch["valid_rows"], 2)
        self.assertEqual(batch["failed_rows"], 0)
        # Masked preview only
        for row in batch["preview_rows"]:
            self.assertNotIn("ABCD-EFGH-IJKL", row.get("code_masked", ""))
            self.assertTrue(row["code_masked"])

        confirm = client.post(
            "/api/v1/admin/codes/import/confirm/",
            {"batch_id": batch["id"]},
            format="json",
        )
        self.assertEqual(confirm.status_code, 200, confirm.content)
        self.assertEqual(confirm.json()["imported_rows"], 2)
        self.assertEqual(confirm.json()["status"], CodeImportBatchStatus.COMPLETED)

        codes = list(DigitalCode.objects.filter(variant=self.variant).order_by("id"))
        self.assertEqual(len(codes), 2)
        for code in codes:
            self.assertEqual(code.source, DigitalCodeSource.CSV_IMPORT)
            self.assertEqual(code.status, DigitalCodeStatus.AVAILABLE)
            self.assertTrue(code.code_fingerprint)
            self.assertNotEqual(code.ciphertext, "")
            plaintext = decrypt_code(code.ciphertext, code.nonce)
            self.assertNotIn(plaintext, (code.masked,))
            # list API never returns ciphertext
        listing = client.get("/api/v1/admin/codes/")
        self.assertEqual(listing.status_code, 200)
        for item in listing.json()["results"]:
            self.assertNotIn("ciphertext", item)
            self.assertNotIn("nonce", item)
            self.assertIn("masked", item)

        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_status, StockStatus.IN_STOCK)
        self.assertTrue(AuditLog.objects.filter(action="codes.import.completed").exists())

    def test_duplicate_in_file_and_database(self):
        client = auth_client(self.admin)
        # Seed existing fingerprint
        from commerce.crypto import encrypt_code

        ct, nonce, masked = encrypt_code("EXISTING-CODE")
        DigitalCode.objects.create(
            variant=self.variant,
            status=DigitalCodeStatus.AVAILABLE,
            source=DigitalCodeSource.MANUAL,
            code_fingerprint=fingerprint_code("EXISTING-CODE"),
            ciphertext=ct,
            nonce=nonce,
            masked=masked,
        )
        f = self._csv(
            [
                ["code"],
                ["DUP-IN-FILE"],
                ["DUP-IN-FILE"],
                ["EXISTING-CODE"],
                ["FRESH-CODE-OK"],
            ]
        )
        preview = client.post(
            "/api/v1/admin/codes/import/preview/",
            {"file": f, "mode": "SIMPLE", "variant_id": self.variant.id},
            format="multipart",
        )
        self.assertEqual(preview.status_code, 201)
        batch = preview.json()["batch"]
        # First DUP-IN-FILE is valid; second is file-dup; EXISTING-CODE is DB-dup; FRESH is valid
        self.assertEqual(batch["valid_rows"], 2)
        self.assertGreaterEqual(batch["duplicate_rows"], 2)
        confirm = client.post(
            "/api/v1/admin/codes/import/confirm/",
            {"batch_id": batch["id"]},
            format="json",
        )
        self.assertEqual(confirm.status_code, 200)
        self.assertEqual(confirm.json()["imported_rows"], 2)
        self.assertEqual(
            DigitalCode.objects.filter(code_fingerprint=fingerprint_code("FRESH-CODE-OK")).count(),
            1,
        )
        self.assertEqual(
            DigitalCode.objects.filter(code_fingerprint=fingerprint_code("DUP-IN-FILE")).count(),
            1,
        )

    def test_advanced_sku_and_unknown_sku(self):
        client = auth_client(self.admin)
        f = self._csv(
            [
                ["sku", "code", "pin"],
                ["PSN-10-US", "ADV-CODE-1", "1111"],
                ["PSN-20-US", "ADV-CODE-2", ""],
                ["MISSING-SKU", "ADV-CODE-3", ""],
            ]
        )
        preview = client.post(
            "/api/v1/admin/codes/import/preview/",
            {"file": f, "mode": "ADVANCED"},
            format="multipart",
        )
        self.assertEqual(preview.status_code, 201)
        batch = preview.json()["batch"]
        self.assertEqual(batch["valid_rows"], 2)
        self.assertEqual(batch["failed_rows"], 1)
        confirm = client.post(
            "/api/v1/admin/codes/import/confirm/",
            {"batch_id": batch["id"]},
            format="json",
        )
        self.assertEqual(confirm.status_code, 200)
        self.assertEqual(confirm.json()["imported_rows"], 2)
        self.assertEqual(confirm.json()["status"], CodeImportBatchStatus.PARTIAL)

    def test_invalid_extension_and_empty_code(self):
        client = auth_client(self.admin)
        bad = SimpleUploadedFile("codes.txt", b"code\nAAA", content_type="text/plain")
        res = client.post(
            "/api/v1/admin/codes/import/preview/",
            {"file": bad, "mode": "SIMPLE", "variant_id": self.variant.id},
            format="multipart",
        )
        self.assertEqual(res.status_code, 400)

        f = self._csv([["code"], [""], ["OK-CODE"]])
        preview = client.post(
            "/api/v1/admin/codes/import/preview/",
            {"file": f, "mode": "SIMPLE", "variant_id": self.variant.id},
            format="multipart",
        )
        self.assertEqual(preview.status_code, 201)
        self.assertEqual(preview.json()["batch"]["failed_rows"], 1)
        self.assertEqual(preview.json()["batch"]["valid_rows"], 1)

    def test_unknown_variant_simple(self):
        client = auth_client(self.admin)
        f = self._csv([["code"], ["AAA"]])
        res = client.post(
            "/api/v1/admin/codes/import/preview/",
            {"file": f, "mode": "SIMPLE", "variant_id": 999999},
            format="multipart",
        )
        self.assertEqual(res.status_code, 404)

    def test_xlsx_import(self):
        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.append(["code", "pin"])
        ws.append(["XLSX-CODE-1", "9999"])
        buf = io.BytesIO()
        wb.save(buf)
        upload = SimpleUploadedFile(
            "codes.xlsx",
            buf.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        client = auth_client(self.admin)
        preview = client.post(
            "/api/v1/admin/codes/import/preview/",
            {"file": upload, "mode": "SIMPLE", "variant_id": self.variant.id},
            format="multipart",
        )
        self.assertEqual(preview.status_code, 201, preview.content)
        confirm = client.post(
            "/api/v1/admin/codes/import/confirm/",
            {"batch_id": preview.json()["batch"]["id"]},
            format="json",
        )
        self.assertEqual(confirm.status_code, 200)
        self.assertEqual(confirm.json()["imported_rows"], 1)

    def test_manual_create_and_deactivate(self):
        client = auth_client(self.order_mgr)
        create = client.post(
            "/api/v1/admin/codes/create/",
            {"variant_id": self.variant.id, "code": "MANUAL-ONLY-1", "pin": "55"},
            format="json",
        )
        self.assertEqual(create.status_code, 201, create.content)
        code_id = create.json()["id"]
        self.assertEqual(create.json()["masked"], mask_code("MANUAL-ONLY-1"))
        self.assertNotIn("ciphertext", create.json())
        self.assertTrue(AuditLog.objects.filter(action="codes.manual_create").exists())

        # Duplicate denied
        dup = client.post(
            "/api/v1/admin/codes/create/",
            {"variant_id": self.variant.id, "code": "MANUAL-ONLY-1", "pin": "55"},
            format="json",
        )
        self.assertEqual(dup.status_code, 409)
        self.assertEqual(dup.json()["code"], "duplicate_code")
        self.assertIn("already in stock", dup.json()["detail"])

        deact = client.post(f"/api/v1/admin/codes/{code_id}/deactivate/")
        self.assertEqual(deact.status_code, 200)
        self.assertEqual(deact.json()["status"], DigitalCodeStatus.UNAVAILABLE)

    def test_template_and_error_report_have_no_plaintext(self):
        client = auth_client(self.admin)
        tpl = client.get("/api/v1/admin/codes/import/template/?mode=SIMPLE")
        self.assertEqual(tpl.status_code, 200)
        self.assertIn("SAMPLE-CODE", tpl.content.decode())

        f = self._csv([["code"], [""], ["GOOD-1"]])
        preview = client.post(
            "/api/v1/admin/codes/import/preview/",
            {"file": f, "mode": "SIMPLE", "variant_id": self.variant.id},
            format="multipart",
        )
        batch_id = preview.json()["batch"]["id"]
        client.post("/api/v1/admin/codes/import/confirm/", {"batch_id": batch_id}, format="json")
        errors = client.get(f"/api/v1/admin/codes/imports/{batch_id}/errors/")
        self.assertEqual(errors.status_code, 200)
        body = errors.content.decode()
        self.assertIn("row,sku,error", body.replace(" ", ""))
        self.assertNotIn("GOOD-1", body)

    def test_fingerprint_does_not_require_decrypt(self):
        fp = fingerprint_code("AA-BB", "12")
        self.assertEqual(len(fp), 64)
        self.assertEqual(fp, fingerprint_code("aa-bb", "12"))
        self.assertNotEqual(fp, fingerprint_code("AA-BB"))

    def test_import_history_list(self):
        client = auth_client(self.admin)
        f = self._csv([["code"], ["HIST-CODE-1"]])
        preview = client.post(
            "/api/v1/admin/codes/import/preview/",
            {"file": f, "mode": "SIMPLE", "variant_id": self.variant.id},
            format="multipart",
        )
        client.post(
            "/api/v1/admin/codes/import/confirm/",
            {"batch_id": preview.json()["batch"]["id"]},
            format="json",
        )
        listing = client.get("/api/v1/admin/codes/imports/")
        self.assertEqual(listing.status_code, 200)
        self.assertGreaterEqual(listing.json()["count"], 1)
        row = listing.json()["results"][0]
        self.assertNotIn("pending_file_path", row)
        body = str(row)
        self.assertNotIn("HIST-CODE-1", body)
