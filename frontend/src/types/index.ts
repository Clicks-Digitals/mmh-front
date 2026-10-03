export type Locale = "en" | "ar";

export type ProductType = "digital";

export type FulfillmentType = "code" | "direct_topup";

export type DeliveryMethod = "account" | "email" | "sms" | "instant_reveal";

export type ProductKind =
  | "gift_card"
  | "wallet"
  | "game_currency"
  | "subscription"
  | "direct_topup"
  | "digital_code";

export type ProductFieldType = "text" | "email" | "tel" | "select";

export type ProductBadge =
  | "new"
  | "bestseller"
  | "limited"
  | "sale"
  | "digital"
  | "instant"
  | "region_locked"
  | "topup";

export type SortOption =
  | "featured"
  | "newest"
  | "price-asc"
  | "price-desc"
  | "rating"
  | "discount";

export type CatalogView = "grid" | "list";

export interface RequiredCustomerField {
  id: string;
  label: string;
  labelAr: string;
  placeholder: string;
  placeholderAr: string;
  type: ProductFieldType;
  required: boolean;
  helpText?: string;
  helpTextAr?: string;
  options?: Array<{ label: string; labelAr: string; value: string }>;
}

export interface DigitalRegion {
  id: string;
  name: string;
  nameAr: string;
  locked: boolean;
  currency?: string;
}

export interface DigitalDenomination {
  id: string;
  regionId?: string;
  label: string;
  labelAr: string;
  value: number;
  currency: string;
  priceJod: number;
  compareAtPriceJod?: number;
  inStock?: boolean;
  deliveryEstimate?: string;
}

export interface DigitalProductOptions {
  platform: string;
  platformLabel: string;
  platformLabelAr: string;
  kind: ProductKind;
  regions: DigitalRegion[];
  denominations: DigitalDenomination[];
  deliveryMethods: DeliveryMethod[];
  deliveryEstimate: string;
  deliveryEstimateAr: string;
  instructions: string;
  instructionsAr: string;
  howToUse: string[];
  howToUseAr: string[];
  regionRestrictions: string;
  regionRestrictionsAr: string;
  regionWarning?: string;
  regionWarningAr?: string;
  accountCurrency?: string;
  refundEligible: boolean;
  refundPolicyText: string;
  refundPolicyTextAr: string;
  instantCode: boolean;
  requiredCustomerFields: RequiredCustomerField[];
}

export interface Product {
  id: string;
  slug: string;
  type: ProductType;
  fulfillmentType: FulfillmentType;
  name: string;
  nameAr: string;
  shortDescription: string;
  shortDescriptionAr: string;
  description: string;
  descriptionAr: string;
  brand: string;
  category: string;
  subcategory?: string;
  images: string[];
  artworkKey: string;
  priceJod: number;
  compareAtPriceJod?: number;
  rating: number;
  reviewCount: number;
  badges: ProductBadge[];
  inStock: boolean;
  digitalOptions: DigitalProductOptions;
  featured?: boolean;
  trending?: boolean;
  bestseller?: boolean;
  createdAt: string;
  tags: string[];
  platform: string;
}

export interface Category {
  slug: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  parent?: string;
  href: string;
  artworkKey: string;
}

export interface Brand {
  slug: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  soldByMmh: true;
}

export interface NavLink {
  href: string;
  labelKey: string;
  mega?: "shop" | "topups" | "gifts" | "playstation" | "mobile";
}

export type GiftIntent = "self" | "recipient";

export interface CartDigitalMeta {
  regionId: string;
  regionName: string;
  denominationId: string;
  denominationLabel: string;
  deliveryMethod: DeliveryMethod;
  deliveryContact: string;
  platform: string;
  customerFields?: Record<string, string>;
  giftIntent?: GiftIntent;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  giftMessage?: string;
}

export interface CartItem {
  lineId: string;
  productId: string;
  quantity: number;
  digital?: CartDigitalMeta;
  addedAt: string;
}

export interface WishlistItem {
  productId: string;
  addedAt: string;
}

export interface MockUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
}

export type OrderStatus = "processing" | "ready" | "fulfilled" | "awaiting" | "failed";

export type TopUpStatus = "awaiting" | "processing" | "completed" | "failed";

export interface MockOrderItem {
  productId: string;
  name: string;
  nameAr: string;
  quantity: number;
  priceJod: number;
  type: ProductType;
  fulfillmentType: FulfillmentType;
  digitalMaskedCode?: string;
  topUpStatus?: TopUpStatus;
  playerIdMasked?: string;
  region?: string;
  denomination?: string;
}

export interface MockOrder {
  id: string;
  createdAt: string;
  status: OrderStatus;
  fulfillment: "digital";
  items: MockOrderItem[];
  subtotalJod: number;
  totalJod: number;
  paymentMethod: string;
}

export interface Review {
  id: string;
  productId: string;
  author: string;
  city: string;
  rating: number;
  title: string;
  titleAr: string;
  body: string;
  bodyAr: string;
  date: string;
}

export interface CheckoutCustomer {
  fullName: string;
  email: string;
  phone: string;
}

export interface CheckoutDigital {
  method: DeliveryMethod;
  contact: string;
}

export interface CheckoutPayment {
  method: "card" | "cliq" | "placeholder" | "paypal";
}

export interface CheckoutDraft {
  customer: CheckoutCustomer;
  digital: CheckoutDigital;
  payment: CheckoutPayment;
  notes: string;
  regionConfirmed: boolean;
  refundConfirmed: boolean;
}

export interface FilterState {
  q?: string;
  category?: string;
  brand?: string;
  type?: FulfillmentType | "";
  kind?: ProductKind | "";
  min?: number;
  max?: number;
  availability?: "in_stock" | "";
  discount?: boolean;
  rating?: number;
  platform?: string;
  region?: string;
  sort?: SortOption;
  view?: CatalogView;
}

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone?: "success" | "error" | "info";
}
