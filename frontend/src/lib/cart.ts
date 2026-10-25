import { getProductById } from "@/data/products";
import { quantityLimits, type QuantityLimits } from "@/lib/quantity";
import { maskValue } from "@/lib/orders";
import { customerFieldsValid } from "@/lib/validation";
import type { CartItem, DigitalDenomination, Product } from "@/types";

export function resolveCartProduct(item: CartItem): Product | undefined {
  return getProductById(item.productId);
}

export function lineDenomination(item: CartItem, product: Product): DigitalDenomination | undefined {
  const options = product.digitalOptions.denominations;
  if (item.digital?.denominationId) return options.find((entry) => entry.id === item.digital?.denominationId);
  return options.length === 1 ? options[0] : undefined;
}

export function lineLimits(item: CartItem, product: Product): QuantityLimits {
  const denomination = lineDenomination(item, product);
  return quantityLimits(denomination?.minQuantity, denomination?.maxQuantity, denomination?.availableQuantity);
}

export function linePrice(item: CartItem, product: Product): number {
  const denomination = lineDenomination(item, product);
  const unit = denomination?.priceJod ?? product.priceJod;
  return Math.round(unit * 1000 * item.quantity) / 1000;
}

export type LineProblem =
  | "missing_product"
  | "missing_option"
  | "out_of_stock"
  | "fields"
  | "quantity"
  | "stock_limited"
  | null;

export function lineProblem(item: CartItem, product: Product | undefined): LineProblem {
  if (!product) return "missing_product";
  const denomination = lineDenomination(item, product);
  if (!denomination) return "missing_option";
  if (denomination.inStock === false || !product.inStock || denomination.availableQuantity === 0) return "out_of_stock";
  if (typeof denomination.availableQuantity === "number" && item.quantity > denomination.availableQuantity) return "stock_limited";
  const limits = lineLimits(item, product);
  if (item.quantity < limits.min || item.quantity > limits.max) return "quantity";
  if (!customerFieldsValid(product.digitalOptions.requiredCustomerFields, item.digital?.customerFields)) return "fields";
  return null;
}

export function lineProblemKey(problem: LineProblem): string {
  switch (problem) {
    case "missing_product":
    case "missing_option":
      return "checkout.lineNeedsOptions";
    case "out_of_stock":
      return "product.stockOut";
    case "fields":
      return "cart.fixLine";
    case "quantity":
      return "product.qtyMax";
    case "stock_limited":
      return "stock.onlyNLeftReduce";
    default:
      return "";
  }
}

export function cartHasRegionLocked(items: CartItem[]): boolean {
  return items.some((item) => {
    const product = getProductById(item.productId);
    return Boolean(product?.digitalOptions.regions.some((region) => region.locked));
  });
}

/** Same rule as order pages (ST-28): short values as typed, longer ones keep the last 3 characters. */
export function maskAccountValue(value?: string): string {
  return maskValue(value ?? "");
}

/** Field values shown with their localized labels (select options show the option label). */
export function lineFieldsText(item: CartItem, product: Product, locale: "en" | "ar"): string {
  return product.digitalOptions.requiredCustomerFields
    .map((field) => {
      const value = item.digital?.customerFields?.[field.id];
      if (!value) return "";
      const label = locale === "ar" ? field.labelAr || field.label : field.label;
      const option = field.options?.find((entry) => entry.value === value);
      const shown = option ? (locale === "ar" ? option.labelAr || option.label : option.label) : maskValue(value);
      return `${label}: ${shown}`;
    })
    .filter(Boolean)
    .join(" · ");
}

/** Checkout payload line for the backend (variant_id preferred). */
export function checkoutLine(item: CartItem, product: Product) {
  const denomination = lineDenomination(item, product);
  return {
    productId: product.id,
    ...(denomination?.variantId ? { variantId: denomination.variantId } : { denominationId: denomination?.id ?? "" }),
    quantity: item.quantity,
    fields: item.digital?.customerFields ?? {},
  };
}
