export interface FaqItem {
  id: string;
  question: string;
  questionAr: string;
  answer: string;
  answerAr: string;
  group: "store" | "digital";
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: "digital-instant",
    group: "digital",
    question: "How fast are digital cards delivered?",
    questionAr: "ما سرعة تسليم البطاقات الرقمية؟",
    answer:
      "Payment is taken with PayPal and the order is marked paid only after our server confirms the capture. Digital delivery starts after that confirmation and appears when fulfillment is completed.",
    answerAr:
      "يتم الدفع عبر PayPal، ولا يُعلَّم الطلب مدفوعاً إلا بعد أن يؤكد خادمنا عملية القبض. يبدأ التسليم الرقمي بعد ذلك ويظهر عند اكتمال التنفيذ.",
  },
  {
    id: "region",
    group: "digital",
    question: "What does region locked mean?",
    questionAr: "ماذا يعني مقيد بالمنطقة؟",
    answer:
      "A region-locked card can only be redeemed on an account whose store country matches the selected region. MMH shows this before purchase. Wrong-region codes cannot be refunded after reveal.",
    answerAr:
      "البطاقة المقيدة تُسترد فقط على حساب تطابق دولته المنطقة المختارة. إم إم إتش يعرض ذلك قبل الشراء. الأكواد الخاطئة المنطقة غير قابلة للاسترجاع بعد الكشف.",
  },
  {
    id: "digital-refund",
    group: "digital",
    question: "Can I refund a digital code?",
    questionAr: "هل يمكن استرجاع كود رقمي؟",
    answer:
      "Generally no once a code is revealed or a top-up is submitted. Confirm region, platform, denomination, and account details before ordering. The final policy remains subject to legal review.",
    answerAr:
      "عادة لا بعد كشف الكود أو إرسال الشحن. أكّد المنطقة والمنصة والفئة وتفاصيل الحساب قبل الطلب. تبقى السياسة النهائية خاضعة للمراجعة القانونية.",
  },
  {
    id: "digital-account",
    group: "digital",
    question: "Which account should I redeem on?",
    questionAr: "على أي حساب يُسترد الكود؟",
    answer:
      "Redeem on the account that matches the region you selected. A UAE/MENA card will not work on a US store account. MMH cannot move a revealed code to another region.",
    answerAr:
      "استرد على الحساب الذي يطابق المنطقة المختارة. بطاقة الإمارات/الشرق الأوسط لا تعمل على حساب أمريكي. إم إم إتش لا يستطيع نقل كود مكشوف إلى منطقة أخرى.",
  },
  {
    id: "player-id",
    group: "digital",
    question: "What if I enter the wrong Player ID?",
    questionAr: "ماذا لو أدخلت معرّف لاعب خاطئاً؟",
    answer:
      "Direct top-ups are applied to the ID you submit. MMH cannot reverse a completed top-up sent to the wrong account. Double-check IDs and Zone IDs before checkout.",
    answerAr:
      "الشحن المباشر يُطبَّق على المعرّف الذي ترسله. لا يمكن التراجع عن شحن مكتمل لحساب خاطئ. راجع المعرّفات قبل الدفع.",
  },
  {
    id: "affiliation",
    group: "store",
    question: "Is MMH officially affiliated with these platforms?",
    questionAr: "هل إم إم إتش مرتبط رسمياً بهذه المنصات؟",
    answer:
      "No. MMH is a Jordanian retailer of digital gaming products. Brands such as PlayStation, Steam, Roblox, and PUBG are sold by MMH and are not owned by MMH.",
    answerAr:
      "لا. إم إم إتش متجر أردني للمنتجات الرقمية. علامات مثل بلايستيشن وستيم وروبلوكس وببجي تُباع عبر إم إم إتش وليست مملوكة له.",
  },
  {
    id: "jordan",
    group: "store",
    question: "Do you support customers in Jordan?",
    questionAr: "هل الدعم متاح في الأردن؟",
    answer:
      "MMH is based in Jordan. Official support contact details have not yet been published on this storefront.",
    answerAr:
      "إم إم إتش في الأردن. لم تُنشر بعد بيانات التواصل الرسمية للدعم على هذا المتجر.",
  },
];

export const DIGITAL_PRODUCT_FAQS = FAQ_ITEMS.filter((item) => item.group === "digital");
