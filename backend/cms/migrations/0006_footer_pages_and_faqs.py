"""D19: built-in policy pages are listed in the footer. ST-31: a real bilingual FAQ set.

FAQs are only added when there is at most one published FAQ (i.e. only the old seed
question), and a question that already exists (same English text) is never duplicated.
"""

from django.db import migrations

FOOTER_SLUGS = ("about", "terms", "privacy", "digital-product-policy")

FAQS = [
    (
        "How fast is delivery?",
        "ما سرعة التسليم؟",
        "Most digital codes are delivered automatically to your order page and email within minutes of the payment "
        "being confirmed. If a code is temporarily out of stock or your order needs a manual check, it can take "
        "longer - we will email you as soon as it is ready.",
        "تُسلَّم معظم الأكواد الرقمية تلقائياً إلى صفحة طلبك وبريدك الإلكتروني خلال دقائق من تأكيد الدفع. إذا نفد "
        "الكود مؤقتاً أو احتاج طلبك إلى مراجعة يدوية فقد يستغرق الأمر وقتاً أطول، وسنرسل لك بريداً إلكترونياً فور جاهزيته.",
    ),
    (
        "How do I pay?",
        "كيف أدفع؟",
        "Payments are processed securely by PayPal. You can pay with your PayPal balance or with a debit/credit card "
        "through PayPal's checkout. We never see or store your card details.",
        "تتم معالجة المدفوعات بأمان عبر PayPal. يمكنك الدفع من رصيد PayPal أو باستخدام بطاقة الخصم/الائتمان عبر صفحة "
        "الدفع الخاصة بـ PayPal. نحن لا نرى بيانات بطاقتك ولا نخزّنها.",
    ),
    (
        "Why is PayPal charging me in US dollars?",
        "لماذا يحاسبني PayPal بالدولار الأمريكي؟",
        "Our prices are shown in Jordanian dinars (JOD), but PayPal settles the payment in US dollars (USD). The JOD "
        "total is converted to USD at checkout, so the amount on your PayPal or bank statement appears in USD and may "
        "differ slightly because of your bank's exchange rate or card fees.",
        "تُعرض أسعارنا بالدينار الأردني، لكن PayPal يحصّل المبلغ بالدولار الأمريكي. يُحوَّل إجمالي الطلب إلى الدولار عند "
        "الدفع، لذلك يظهر المبلغ في كشف PayPal أو البنك بالدولار وقد يختلف قليلاً بسبب سعر الصرف أو رسوم البطاقة لدى بنكك.",
    ),
    (
        "Where do I find my code after buying?",
        "أين أجد الكود بعد الشراء؟",
        "Open your order from the confirmation email, from \"My orders\" in your account, or with the order lookup "
        "page (order number + email). Codes are shown on the order page once delivered.",
        "افتح طلبك من رسالة التأكيد في بريدك، أو من \"طلباتي\" في حسابك، أو من صفحة البحث عن الطلب (رقم الطلب + البريد "
        "الإلكتروني). تظهر الأكواد في صفحة الطلب بعد تسليمها.",
    ),
    (
        "Do gift cards work in every country?",
        "هل تعمل بطاقات الهدايا في كل الدول؟",
        "No. Many cards are region-locked and only work with an account from the matching region (for example a US "
        "PlayStation card only works on a US PlayStation account). Check the region shown on the product before you "
        "buy - codes for the wrong region cannot be refunded once delivered.",
        "لا. كثير من البطاقات مقيّدة بمنطقة معيّنة وتعمل فقط مع حساب من نفس المنطقة (مثلاً بطاقة بلايستيشن الأمريكية تعمل "
        "فقط على حساب بلايستيشن أمريكي). تحقّق من المنطقة الظاهرة على المنتج قبل الشراء، فلا يمكن استرجاع كود لمنطقة خاطئة بعد تسليمه.",
    ),
    (
        "How do game top-ups work?",
        "كيف يعمل شحن الألعاب؟",
        "For direct top-ups (such as PUBG Mobile UC or Free Fire diamonds) you enter your in-game Player ID at "
        "checkout and we credit the amount straight to that account - there is no code to redeem. Double-check the ID: "
        "top-ups sent to an ID you entered by mistake cannot be reversed.",
        "في الشحن المباشر (مثل شدات ببجي موبايل أو جواهر فري فاير) تُدخل معرّف اللاعب عند الدفع ونشحن الرصيد مباشرة إلى "
        "ذلك الحساب دون كود. تأكّد من المعرّف جيداً، فلا يمكن إلغاء شحن تم إلى معرّف أُدخل بالخطأ.",
    ),
    (
        "Can I get a refund?",
        "هل يمكنني استرجاع المبلغ؟",
        "Digital codes and top-ups generally cannot be refunded once they have been delivered. If we cannot deliver "
        "your order, or a code we sent does not work, contact us with your order number and we will replace it or "
        "refund you to the original payment method.",
        "لا يمكن عادةً استرجاع مبلغ الأكواد الرقمية أو الشحن بعد تسليمها. إذا لم نتمكن من تسليم طلبك أو كان الكود المرسل "
        "لا يعمل، تواصل معنا مع رقم الطلب وسنستبدله أو نعيد المبلغ إلى وسيلة الدفع الأصلية.",
    ),
    (
        "What if I did not finish paying?",
        "ماذا لو لم أكمل الدفع؟",
        "Unpaid orders stay \"Awaiting payment\" - you can complete the payment or cancel the order from the order "
        "page. Orders that are not paid within 72 hours are cancelled automatically, and nothing is charged.",
        "تبقى الطلبات غير المدفوعة بحالة \"بانتظار الدفع\"، ويمكنك إكمال الدفع أو إلغاء الطلب من صفحة الطلب. تُلغى "
        "الطلبات غير المدفوعة تلقائياً بعد 72 ساعة دون أي خصم.",
    ),
    (
        "Do I need an account to buy?",
        "هل أحتاج إلى حساب للشراء؟",
        "No - you can check out as a guest with your email address. Creating an account lets you see all your orders "
        "and codes in one place.",
        "لا، يمكنك الشراء كزائر باستخدام بريدك الإلكتروني. إنشاء حساب يتيح لك رؤية جميع طلباتك وأكوادك في مكان واحد.",
    ),
    (
        "How do I contact support?",
        "كيف أتواصل مع الدعم؟",
        "Use the contact page or the support channels listed in the site footer, and include your order number so we "
        "can help you quickly.",
        "استخدم صفحة التواصل أو قنوات الدعم الظاهرة في أسفل الموقع، وأرفق رقم طلبك لنتمكن من مساعدتك بسرعة.",
    ),
]


def forwards(apps, schema_editor):
    ContentPage = apps.get_model("cms", "ContentPage")
    FAQ = apps.get_model("cms", "FAQ")
    for index, slug in enumerate(FOOTER_SLUGS):
        ContentPage.objects.filter(slug=slug).update(show_in_footer=True, sort_order=index)

    if FAQ.objects.filter(published=True).count() > 1:
        return
    start = (FAQ.objects.order_by("-sort_order").values_list("sort_order", flat=True).first() or 0) + 1
    for offset, (q_en, q_ar, a_en, a_ar) in enumerate(FAQS):
        existing = FAQ.objects.filter(question_en__iexact=q_en).first()
        if existing is not None:
            # Replace an untranslated / one-line seed answer with the fuller text.
            if not existing.answer_ar or len(existing.answer_en) < len(a_en):
                existing.question_ar = existing.question_ar or q_ar
                existing.answer_en = a_en
                existing.answer_ar = a_ar
                existing.save(update_fields=["question_ar", "answer_en", "answer_ar"])
            continue
        FAQ.objects.create(
            question_en=q_en,
            question_ar=q_ar,
            answer_en=a_en,
            answer_ar=a_ar,
            published=True,
            sort_order=start + offset,
        )


class Migration(migrations.Migration):
    dependencies = [
        ("cms", "0005_contentpage_footer"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
