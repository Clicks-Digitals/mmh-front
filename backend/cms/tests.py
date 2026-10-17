from django.test import TestCase

from cms.models import SiteSettings


class PublicSiteSettingsTests(TestCase):
    def test_exposes_contact_channels_only(self):
        settings_obj = SiteSettings.load()
        settings_obj.support_email = "help@mmhcard.com"
        settings_obj.whatsapp_number = "962791234567"
        settings_obj.instagram_url = "https://instagram.com/mmhcard"
        settings_obj.low_stock_threshold = 9
        settings_obj.maintenance_mode = True
        settings_obj.save()

        response = self.client.get("/api/v1/cms/settings/")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["support_email"], "help@mmhcard.com")
        self.assertEqual(body["whatsapp_number"], "962791234567")
        self.assertEqual(body["instagram_url"], "https://instagram.com/mmhcard")
        self.assertNotIn("low_stock_threshold", body)
        self.assertNotIn("maintenance_mode", body)
        self.assertNotIn("currency_display", body)
