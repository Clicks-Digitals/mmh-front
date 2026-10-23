/** Default copy for info pages, shown when the CMS page (Admin → Content → Pages) is not published. */

export type LegalSlug = "about" | "terms" | "privacy" | "digital-product-policy";

export interface LegalDefault {
  title: { en: string; ar: string };
  description: string;
  sections: Array<{ heading?: { en: string; ar: string }; body: { en: string; ar: string } }>;
}

export const LEGAL_DEFAULTS: Record<LegalSlug, LegalDefault> = {
  about: {
    title: { en: "About MMH", ar: "عن MMH" },
    description: "MMH is a Jordanian store for digital gaming codes, gift cards and direct game top-ups.",
    sections: [
      {
        body: {
          en: "MMH is a store based in Amman, Jordan, selling digital gaming products: gift cards, wallet cards, game currencies, subscriptions and selected direct account top-ups. Prices are shown in Jordanian dinars (JOD).",
          ar: "MMH متجر مقره عمّان، الأردن، يبيع منتجات الألعاب الرقمية: بطاقات الهدايا وبطاقات المحافظ وعملات الألعاب والاشتراكات وعمليات شحن مباشرة مختارة للحسابات. تُعرض الأسعار بالدينار الأردني.",
        },
      },
      {
        heading: { en: "How ordering works", ar: "كيف يتم الطلب" },
        body: {
          en: "You pay securely with PayPal. Once the payment is confirmed, digital codes are delivered to your order page and to your checkout email — usually automatically from our stock, otherwise by our team. Direct top-ups are processed by our team to the account details you provide.",
          ar: "تدفع بأمان عبر PayPal. بعد تأكيد الدفع، تُسلَّم الأكواد الرقمية إلى صفحة طلبك وإلى بريدك المستخدم عند الدفع — غالباً تلقائياً من مخزوننا، وإلا يسلّمها فريقنا. أما الشحن المباشر فيعالجه فريقنا إلى بيانات الحساب التي تقدّمها.",
        },
      },
      {
        heading: { en: "Brands", ar: "العلامات التجارية" },
        body: {
          en: "Platforms such as PlayStation, Steam, Xbox, Roblox and PUBG Mobile are sold by MMH. MMH is an independent retailer and is not affiliated with these brands.",
          ar: "تُباع منصات مثل بلايستيشن وستيم وإكس بوكس وروبلوكس وببجي موبايل عبر MMH. MMH متجر تجزئة مستقل وغير مرتبط بهذه العلامات.",
        },
      },
      {
        heading: { en: "Support", ar: "الدعم" },
        body: {
          en: "Questions about an order? Reach us through the Contact page and keep your order number ready.",
          ar: "لديك سؤال عن طلب؟ تواصل معنا عبر صفحة التواصل وجهّز رقم الطلب.",
        },
      },
    ],
  },
  terms: {
    title: { en: "Terms of sale", ar: "شروط البيع" },
    description: "Terms for buying digital gaming products from MMH.",
    sections: [
      {
        heading: { en: "Products and prices", ar: "المنتجات والأسعار" },
        body: {
          en: "MMH sells digital products only; nothing is shipped. Prices are in Jordanian dinars (JOD) and are confirmed by our server when your order is created. Availability can change until payment is confirmed.",
          ar: "تبيع MMH منتجات رقمية فقط ولا يتم شحن أي شيء. الأسعار بالدينار الأردني ويؤكدها خادمنا عند إنشاء الطلب. قد يتغير التوفر حتى تأكيد الدفع.",
        },
      },
      {
        heading: { en: "Payment", ar: "الدفع" },
        body: {
          en: "Payments are made through PayPal. PayPal charges the order total in its payment currency (USD) at our current exchange rate; the exact amount is shown before you approve the payment. An order is treated as paid only after PayPal confirms the payment to our server.",
          ar: "يتم الدفع عبر PayPal. يخصم PayPal إجمالي الطلب بعملة الدفع لديه (الدولار الأمريكي) حسب سعر الصرف الحالي لدينا، ويظهر المبلغ الدقيق قبل موافقتك على الدفع. يُعتبر الطلب مدفوعاً فقط بعد أن يؤكد PayPal الدفع لخادمنا.",
        },
      },
      {
        heading: { en: "Delivery", ar: "التسليم" },
        body: {
          en: "Digital codes are delivered after payment confirmation — usually automatically from stock, otherwise by our team — on your order page, in your account (if signed in) and by email. Direct top-ups are processed by our team to the account details you entered.",
          ar: "تُسلَّم الأكواد الرقمية بعد تأكيد الدفع — غالباً تلقائياً من المخزون، وإلا يسلّمها فريقنا — في صفحة الطلب وفي حسابك (إذا كنت مسجلاً) وبالبريد الإلكتروني. أما الشحن المباشر فيعالجه فريقنا إلى بيانات الحساب التي أدخلتها.",
        },
      },
      {
        heading: { en: "Your responsibility", ar: "مسؤوليتك" },
        body: {
          en: "Choose the correct product, region and account details (such as Player ID) before paying. Region-locked products only work on accounts from the matching region.",
          ar: "اختر المنتج والمنطقة وبيانات الحساب الصحيحة (مثل معرّف اللاعب) قبل الدفع. المنتجات المقيدة بمنطقة تعمل فقط على حسابات من المنطقة المطابقة.",
        },
      },
      {
        heading: { en: "Refunds", ar: "الاسترجاع" },
        body: {
          en: "Refunds are handled according to our Digital product policy. Delivered codes and completed top-ups generally cannot be refunded.",
          ar: "تتم معالجة طلبات الاسترجاع وفق سياسة المنتجات الرقمية لدينا. الأكواد المسلّمة وعمليات الشحن المكتملة غير قابلة للاسترجاع عادةً.",
        },
      },
      {
        heading: { en: "Contact", ar: "التواصل" },
        body: {
          en: "For any question about these terms or an order, contact us through the Contact page.",
          ar: "لأي سؤال حول هذه الشروط أو حول طلب، تواصل معنا عبر صفحة التواصل.",
        },
      },
    ],
  },
  privacy: {
    title: { en: "Privacy policy", ar: "سياسة الخصوصية" },
    description: "How MMH handles your account, order and payment information.",
    sections: [
      {
        heading: { en: "What we collect", ar: "ما الذي نجمعه" },
        body: {
          en: "When you order, we collect your name, email, optional phone number, the products you buy and any account details a product needs (such as a Player ID). If you create an account, we store your login details.",
          ar: "عند الطلب نجمع اسمك وبريدك الإلكتروني ورقم هاتفك الاختياري والمنتجات التي تشتريها وأي بيانات حساب يحتاجها المنتج (مثل معرّف اللاعب). وإذا أنشأت حساباً نحفظ بيانات تسجيل الدخول.",
        },
      },
      {
        heading: { en: "Payments", ar: "المدفوعات" },
        body: {
          en: "Payments are processed by PayPal. We never see or store your card details; we keep the PayPal order and capture references needed to confirm payments and handle refunds.",
          ar: "تتم معالجة المدفوعات عبر PayPal. لا نطّلع على بيانات بطاقتك ولا نحفظها، ونحتفظ فقط بمراجع طلب PayPal وعملية الدفع اللازمة لتأكيد المدفوعات ومعالجة الاسترجاع.",
        },
      },
      {
        heading: { en: "How we use it", ar: "كيف نستخدمها" },
        body: {
          en: "We use your information to process and deliver your orders, send order emails, provide support and keep the store secure. We do not sell your personal data.",
          ar: "نستخدم معلوماتك لمعالجة طلباتك وتسليمها وإرسال رسائل الطلب وتقديم الدعم والحفاظ على أمان المتجر. لا نبيع بياناتك الشخصية.",
        },
      },
      {
        heading: { en: "Your browser", ar: "متصفحك" },
        body: {
          en: "Your cart, wishlist and language preference are stored in your browser. We use essential cookies for sign-in, checkout and language.",
          ar: "تُحفظ سلتك وقائمة المفضلة وتفضيل اللغة في متصفحك. نستخدم ملفات تعريف ارتباط أساسية لتسجيل الدخول وإتمام الطلب واللغة.",
        },
      },
      {
        heading: { en: "Contact", ar: "التواصل" },
        body: {
          en: "To ask about or update your data, contact us through the Contact page.",
          ar: "للاستفسار عن بياناتك أو تحديثها، تواصل معنا عبر صفحة التواصل.",
        },
      },
    ],
  },
  "digital-product-policy": {
    title: { en: "Digital product policy", ar: "سياسة المنتجات الرقمية" },
    description: "Delivery, region compatibility, top-ups and refunds for MMH digital products.",
    sections: [
      {
        heading: { en: "Delivery", ar: "التسليم" },
        body: {
          en: "Codes are delivered after payment confirmation — usually automatically from our stock, otherwise by our team. They appear on your order page and in your account, and are emailed to your checkout email. Keep your codes private.",
          ar: "تُسلَّم الأكواد بعد تأكيد الدفع — غالباً تلقائياً من مخزوننا، وإلا يسلّمها فريقنا. تظهر في صفحة الطلب وفي حسابك وتُرسل إلى بريدك المستخدم عند الدفع. احتفظ بأكوادك بسرية.",
        },
      },
      {
        heading: { en: "Direct top-ups", ar: "الشحن المباشر" },
        body: {
          en: "Top-ups are processed by our team to the Player ID or account details you enter. Check them carefully: a top-up sent to the details you provided cannot be reversed.",
          ar: "يعالج فريقنا الشحن إلى معرّف اللاعب أو بيانات الحساب التي تُدخلها. راجعها بعناية: لا يمكن عكس شحن أُرسل إلى البيانات التي قدّمتها.",
        },
      },
      {
        heading: { en: "Regions", ar: "المناطق" },
        body: {
          en: "Many cards only work on accounts from a specific region or currency. The region is shown on each product; buy the one that matches your account.",
          ar: "تعمل كثير من البطاقات فقط على حسابات من منطقة أو عملة محددة. تظهر المنطقة على كل منتج، فاشترِ ما يطابق حسابك.",
        },
      },
      {
        heading: { en: "Refunds", ar: "الاسترجاع" },
        body: {
          en: "Because digital products can be used immediately, delivered codes and completed top-ups are generally not refundable. If an order cannot be delivered, or a code we supplied does not work, contact us with your order number and we will review it and refund or replace where appropriate. Approved refunds are returned through PayPal.",
          ar: "لأن المنتجات الرقمية يمكن استخدامها مباشرة بعد تسليمها، فإن الأكواد المسلّمة وعمليات الشحن المكتملة غير قابلة للاسترجاع عادةً. إذا تعذّر تسليم الطلب أو لم يعمل كود قدمناه، تواصل معنا برقم الطلب وسنراجعه ونسترد المبلغ أو نستبدل الكود حسب الحالة. تُعاد المبالغ المعتمدة عبر PayPal.",
        },
      },
      {
        heading: { en: "Contact", ar: "التواصل" },
        body: {
          en: "For help with an order, use the Contact page and include your order number.",
          ar: "للمساعدة في طلب، استخدم صفحة التواصل واذكر رقم الطلب.",
        },
      },
    ],
  },
};
