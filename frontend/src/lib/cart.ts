import { getProductById } from "@/data/products";
import { quantityLimits, type QuantityLimits } from "@/lib/quantity";
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
  return quantityLimits(denomination?.minQuantity, denomination?.maxQuantity);
}

export function linePrice(item: CartItem, product: Product): number {
  const denomination = lineDenomination(item, product);
  const unit = denomination?.priceJod ?? product.priceJod;
  return Math.round(unit * 1000 * item.quantity) / 1000;
}

export type LineProblem = "missing_product" | "missing_option" | "out_of_stock" | "fields" | "quantity" | null;

export function lineProblem(item: CartItem, product: Product | undefined): LineProblem {
  if (!product) return "missing_product";
  const denomination = lineDenomination(item, product);
  if (!denomination) return "missing_option";
  if (denomination.inStock === false || !product.inStock) return "out_of_stock";
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

export function maskAccountValue(value?: string): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
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
