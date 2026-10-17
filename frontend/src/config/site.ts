export const SITE = {
  name: "MMH",
  legalName: "MMH",
  tagline: "Your games. Your credit. One place.",
  taglineAr: "ألعابك. رصيدك. في مكان واحد.",
  description:
    "MMH is a Jordanian store for digital gaming codes, gift cards, wallet credit, subscriptions, and selected direct account top-ups.",
  descriptionAr:
    "إم إم إتش متجر أردني لأكواد الألعاب الرقمية وبطاقات الهدايا ورصيد المحافظ والاشتراكات وشحن الحسابات المباشر.",
  url: "http://localhost:3001",
  currency: "JOD",
  currencyLabel: "JOD",
  localeDefault: "en" as const,
  contact: {
    phone: "",
    phoneNote: "",
    email: "",
    emailNote: "",
    address: "",
    city: "Amman, Jordan",
    hours: "",
    // Phone, email, hours, chat buttons and social links are managed in Admin → Settings.
  },
  delivery: {
    estimate: "Issued after your payment is confirmed.",
    estimateAr: "يُصدر بعد تأكيد الدفع.",
    topupEstimate: "Submitted for processing after checkout",
    topupEstimateAr: "يُرسل للمعالجة بعد إتمام الطلب",
  },
} as const;
