export interface FaqItem {
  id: string;
  question: string;
  questionAr: string;
  answer: string;
  answerAr: string;
  group: "store" | "digital";
}

/** Fallback FAQ shown when no FAQ is published in Admin → Content → FAQ. */
export const FAQ_ITEMS: FaqItem[] = [
  {
    id: "digital-delivery",
    group: "digital",
    question: "When do I receive my code?",
    questionAr: "متى أستلم الكود؟",
    answer:
      "Codes are delivered after payment confirmation — usually automatically from stock, otherwise by our team. They appear on your order page and in your account, and are emailed to your checkout email. Direct top-ups are processed by our team.",
    answerAr:
      "تُسلَّم الأكواد بعد تأكيد الدفع — غالباً تلقائياً من المخزون، وإلا يسلّمها فريقنا. تظهر في صفحة الطلب وفي حسابك وتُرسل إلى بريدك المستخدم عند الدفع. أما الشحن المباشر فيعالجه فريقنا.",
  },
  {
    id: "payment",
    group: "store",
    question: "How do I pay?",
    questionAr: "كيف أدفع؟",
    answer:
      "Payments are made securely with PayPal. Prices are in JOD; PayPal charges in USD at our current rate, and the exact amount is shown before you approve the payment.",
    answerAr:
      "يتم الدفع بأمان عبر PayPal. الأسعار بالدينار الأردني، ويخصم PayPal المبلغ بالدولار الأمريكي حسب سعر الصرف الحالي لدينا، ويظهر المبلغ الدقيق قبل موافقتك على الدفع.",
  },
  {
    id: "region",
    group: "digital",
    question: "What does region locked mean?",
    questionAr: "ماذا يعني مقيد بالمنطقة؟",
    answer:
      "A region-locked card can only be redeemed on an account whose store country matches the selected region. The region is shown on every product before you buy.",
    answerAr:
      "البطاقة المقيدة بالمنطقة تُسترد فقط على حساب تطابق دولة متجره المنطقة المختارة. تظهر المنطقة على كل منتج قبل الشراء.",
  },
  {
    id: "digital-refund",
    group: "digital",
    question: "Can I refund a digital code?",
    questionAr: "هل يمكن استرجاع كود رقمي؟",
    answer:
      "Delivered codes and completed top-ups are generally not refundable. If a code we supplied does not work or an order cannot be delivered, contact us with your order number. See our Digital product policy for details.",
    answerAr:
      "الأكواد المسلّمة وعمليات الشحن المكتملة غير قابلة للاسترجاع عادةً. إذا لم يعمل كود قدمناه أو تعذّر تسليم الطلب، تواصل معنا برقم الطلب. راجع سياسة المنتجات الرقمية للتفاصيل.",
  },
  {
    id: "player-id",
    group: "digital",
    question: "What if I enter the wrong Player ID?",
    questionAr: "ماذا لو أدخلت معرّف لاعب خاطئاً؟",
    answer:
      "Direct top-ups are applied to the ID you submit and cannot be reversed once completed. Double-check Player IDs and Zone IDs before checkout.",
    answerAr:
      "يُطبَّق الشحن المباشر على المعرّف الذي ترسله ولا يمكن التراجع عنه بعد اكتماله. راجع معرّف اللاعب ومعرّف المنطقة قبل الدفع.",
  },
  {
    id: "track",
    group: "store",
    question: "How do I track my order?",
    questionAr: "كيف أتتبع طلبي؟",
    answer:
      "Open the link in your order email, sign in to your account, or use the Track an order page with your order number and checkout email.",
    answerAr: "افتح الرابط في بريد الطلب، أو سجّل الدخول إلى حسابك، أو استخدم صفحة تتبّع الطلب برقم الطلب وبريدك المستخدم عند الدفع.",
  },
  {
    id: "affiliation",
    group: "store",
    question: "Is MMH officially affiliated with these platforms?",
    questionAr: "هل MMH مرتبط رسمياً بهذه المنصات؟",
    answer:
      "No. MMH is an independent Jordanian retailer of digital gaming products. Brands such as PlayStation, Steam, Roblox and PUBG are sold by MMH and are not owned by MMH.",
    answerAr:
      "لا. MMH متجر أردني مستقل للمنتجات الرقمية. علامات مثل بلايستيشن وستيم وروبلوكس وببجي تُباع عبر MMH وليست مملوكة له.",
  },
  {
    id: "jordan",
    group: "store",
    question: "Where is MMH based?",
    questionAr: "أين يقع MMH؟",
    answer: "MMH is based in Amman, Jordan. Reach us through the Contact page.",
    answerAr: "مقر MMH في عمّان، الأردن. تواصل معنا عبر صفحة التواصل.",
  },
];

export const DIGITAL_PRODUCT_FAQS = FAQ_ITEMS.filter((item) => item.group === "digital");
