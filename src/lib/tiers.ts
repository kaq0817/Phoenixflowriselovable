/**
 * PHOENIX FLOW: STRIPE PRODUCT CATALOG
 * Source: Stripe products CSV export - 2026-03-25
 * These are the only live packages that currently exist in Stripe.
 */

export const STRIPE_PRODUCTS = {
  SPARK_ETSY_MONTHLY: "prod_U8Ql8O4CAH7EtR",
  SPARK_SHOPIFY_YEARLY: "prod_U8RZnmJGxnQ0Jw",
  RISE_ETSY_MONTHLY: "prod_UD2nX7EaGsxrnb",
  REIGN_TEN_STORES_MONTHLY: "prod_UDQxNtHsLCdNGK",
  REIGN_TEN_STORES_YEARLY: "prod_UDQtGIhlzqYICz",
  ASCEND_FIVE_STORES_MONTHLY: "prod_UDQfUkGxtrPQay",
  TRANSCEND_FORTY_STORES_MONTHLY: "prod_U8RC6wioPFz5uX",
  TRANSCEND_FORTY_STORES_YEARLY: "prod_U8TEHkXHb8naio",
  RISE_SHOPIFY_YEARLY: "prod_U8So6Vf7BsyU4e",
  SPARK_SHOPIFY_MONTHLY: "prod_U8Sl0IykdxvN7q",
  ASCEND_FIVE_STORES_YEARLY: "prod_U8R7QcJ1QjKfhj",
  RISE_ETSY_YEARLY: "prod_U8Qnc3mKuDjHU3",
  SPARK_ETSY_YEARLY: "prod_U8QkDuYfmta0pw",
  RISE_SHOPIFY_THREE_STORES_MONTHLY: "prod_UDR5GIa5P4nFeu",

  SCAN_SINGLE: "prod_U8RnwNAWiMyF4K",
  SCAN_PACK_THREE: "prod_U7sxKLhOv6tRCs",
  SCAN_PACK_TEN: "prod_U8RlNjLt4R5CSJ",
  SCAN_PACK_TWENTY_FIVE: "prod_U8QpzRv9aJUZXC",

  APP_WALKTHROUGH: "prod_U8RnJY32kFCGcB",
} as const;

export const STRIPE_PRICES: Record<string, string> = {
  [STRIPE_PRODUCTS.RISE_SHOPIFY_THREE_STORES_MONTHLY]: "price_1TF0DGGUZx3v4iGjx91mU18j",
  [STRIPE_PRODUCTS.REIGN_TEN_STORES_MONTHLY]: "price_1TF05CGUZx3v4iGjGTrFpsMY",
  [STRIPE_PRODUCTS.REIGN_TEN_STORES_YEARLY]: "price_1TF01WGUZx3v4iGjOqjTYRe2",
  [STRIPE_PRODUCTS.ASCEND_FIVE_STORES_MONTHLY]: "price_1TEzoNGUZx3v4iGjmaUX2w5W",
  [STRIPE_PRODUCTS.RISE_ETSY_MONTHLY]: "price_1TEciIGUZx3v4iGjSqcfHXVa",
  [STRIPE_PRODUCTS.TRANSCEND_FORTY_STORES_YEARLY]: "price_1TACIUGUZx3v4iGjk5hL2ytz",
  [STRIPE_PRODUCTS.RISE_SHOPIFY_YEARLY]: "price_1TABsWGUZx3v4iGjHz3ZVmuo",
  [STRIPE_PRODUCTS.SPARK_SHOPIFY_MONTHLY]: "price_1TABq5GUZx3v4iGj7CqTHaUj",
  [STRIPE_PRODUCTS.APP_WALKTHROUGH]: "price_1TAAuMGUZx3v4iGjMc0lSu3L",
  [STRIPE_PRODUCTS.SCAN_SINGLE]: "price_1TAAtdGUZx3v4iGj6HGyl4me",
  [STRIPE_PRODUCTS.SCAN_PACK_TEN]: "price_1TAAs3GUZx3v4iGjmy5YutRI",
  [STRIPE_PRODUCTS.SPARK_SHOPIFY_YEARLY]: "price_1TAAgUGUZx3v4iGjzGu5XLeA",
  [STRIPE_PRODUCTS.TRANSCEND_FORTY_STORES_MONTHLY]: "price_1TAAKMGUZx3v4iGjxG8I2oGO",
  [STRIPE_PRODUCTS.ASCEND_FIVE_STORES_YEARLY]: "price_1TAAF5GUZx3v4iGjnjpWl8Mq",
  [STRIPE_PRODUCTS.SCAN_PACK_TWENTY_FIVE]: "price_1TA9y2GUZx3v4iGju7eCWtQE",
  [STRIPE_PRODUCTS.RISE_ETSY_YEARLY]: "price_1TA9vVGUZx3v4iGjs5QT1i1p",
  [STRIPE_PRODUCTS.SPARK_ETSY_MONTHLY]: "price_1TA9uJGUZx3v4iGjJzKwS65d",
  [STRIPE_PRODUCTS.SPARK_ETSY_YEARLY]: "price_1TA9sqGUZx3v4iGjvoznpjmm",
  [STRIPE_PRODUCTS.SCAN_PACK_THREE]: "price_1T9dBVGUZx3v4iGjhWoDIokf",
};

export interface SubscriptionTier {
  stripeId: string;
  name: string;
  price: number;
  billing: "monthly" | "yearly" | "6-months";
  description: string;
  stores: number;
  category: "subscription";
  checkoutMode: "subscription" | "payment";
}

export interface ComplianceProduct {
  stripeId: string;
  name: string;
  price: number | null;
  billing: "monthly" | "one-time";
  description: string;
  scans: number;
  maxProducts: number;
  expiry: string;
  category: "compliance";
}

export interface BundleProduct {
  stripeId: string;
  name: string;
  price: number | null;
  description: string;
  category: "bundle";
}

export const SUBSCRIPTION_TIERS: SubscriptionTier[] = [
  {
    stripeId: "",
    name: "Free Trial",
    price: 0,
    billing: "6-months",
    description: "5 free operations to test. Store verification required. 1 store limit.",
    stores: 1,
    category: "subscription",
    checkoutMode: "payment",
  },
  {
    stripeId: STRIPE_PRODUCTS.SPARK_ETSY_MONTHLY,
    name: "Phoenix Spark - Etsy",
    price: 12,
    billing: "monthly",
    description: "Entry Etsy plan for one store with core listing optimization.",
    stores: 1,
    category: "subscription",
    checkoutMode: "subscription",
  },
  {
    stripeId: STRIPE_PRODUCTS.RISE_ETSY_MONTHLY,
    name: "Phoenix Rise - Etsy",
    price: 24,
    billing: "monthly",
    description: "Higher-output Etsy plan for one store with stronger optimization coverage.",
    stores: 1,
    category: "subscription",
    checkoutMode: "subscription",
  },
  {
    stripeId: STRIPE_PRODUCTS.SPARK_SHOPIFY_MONTHLY,
    name: "Phoenix Spark - Shopify 1 Store",
    price: 39,
    billing: "monthly",
    description: "Shopify starter plan for one store.",
    stores: 1,
    category: "subscription",
    checkoutMode: "subscription",
  },
  {
    stripeId: STRIPE_PRODUCTS.RISE_SHOPIFY_THREE_STORES_MONTHLY,
    name: "Phoenix Rise - Shopify 3 stores",
    price: 99,
    billing: "monthly",
    description: "Shopify growth plan for up to 3 stores.",
    stores: 3,
    category: "subscription",
    checkoutMode: "subscription",
  },
  {
    stripeId: STRIPE_PRODUCTS.ASCEND_FIVE_STORES_MONTHLY,
    name: "Phoenix Ascend 5 stores",
    price: 199,
    billing: "monthly",
    description: "Multi-store monthly plan for up to 5 stores.",
    stores: 5,
    category: "subscription",
    checkoutMode: "subscription",
  },
  {
    stripeId: STRIPE_PRODUCTS.REIGN_TEN_STORES_MONTHLY,
    name: "Phoenix Reign 10 store mix",
    price: 399,
    billing: "monthly",
    description: "Mixed-store monthly plan for up to 10 stores.",
    stores: 10,
    category: "subscription",
    checkoutMode: "subscription",
  },
  {
    stripeId: STRIPE_PRODUCTS.TRANSCEND_FORTY_STORES_MONTHLY,
    name: "Phoenix Transcend(40 Stores)",
    price: 1999,
    billing: "monthly",
    description: "Enterprise-scale monthly plan for up to 40 stores.",
    stores: 40,
    category: "subscription",
    checkoutMode: "subscription",
  },
  {
    stripeId: STRIPE_PRODUCTS.SPARK_ETSY_YEARLY,
    name: "Phoenix Spark - Etsy (Annual)",
    price: 99,
    billing: "yearly",
    description: "One-time annual Etsy package for one store.",
    stores: 1,
    category: "subscription",
    checkoutMode: "payment",
  },
  {
    stripeId: STRIPE_PRODUCTS.RISE_ETSY_YEARLY,
    name: "Phoenix Rise - Etsy (Annual)",
    price: 199,
    billing: "yearly",
    description: "One-time annual Etsy package for one store.",
    stores: 1,
    category: "subscription",
    checkoutMode: "payment",
  },
  {
    stripeId: STRIPE_PRODUCTS.SPARK_SHOPIFY_YEARLY,
    name: "Phoenix Spark - Shopify (Annual) 1 store",
    price: 420,
    billing: "yearly",
    description: "Yearly Shopify starter plan for one store.",
    stores: 1,
    category: "subscription",
    checkoutMode: "subscription",
  },
  {
    stripeId: STRIPE_PRODUCTS.RISE_SHOPIFY_YEARLY,
    name: "Phoenix Rise - Shopify (Annual)",
    price: 1069,
    billing: "yearly",
    description: "Yearly Shopify growth plan with expanded store coverage.",
    stores: 3,
    category: "subscription",
    checkoutMode: "subscription",
  },
  {
    stripeId: STRIPE_PRODUCTS.ASCEND_FIVE_STORES_YEARLY,
    name: "Phoenix Ascend (Annual)",
    price: 1990,
    billing: "yearly",
    description: "Yearly multi-store plan for 5 stores.",
    stores: 5,
    category: "subscription",
    checkoutMode: "subscription",
  },
  {
    stripeId: STRIPE_PRODUCTS.REIGN_TEN_STORES_YEARLY,
    name: "Phoenix Reign Annual",
    price: 3990,
    billing: "yearly",
    description: "Yearly mixed-store plan for up to 10 stores.",
    stores: 10,
    category: "subscription",
    checkoutMode: "subscription",
  },
  {
    stripeId: STRIPE_PRODUCTS.TRANSCEND_FORTY_STORES_YEARLY,
    name: "Phoenix Transcend - Agency Elite (Annual)",
    price: 19990,
    billing: "yearly",
    description: "Yearly agency-tier plan for up to 40 stores.",
    stores: 40,
    category: "subscription",
    checkoutMode: "subscription",
  },
];

export const COMPLIANCE_PRODUCTS: ComplianceProduct[] = [
  {
    stripeId: STRIPE_PRODUCTS.SCAN_SINGLE,
    name: "Phoenix Scan - Single",
    price: 49,
    billing: "one-time",
    description: "1 compliance scan.",
    scans: 1,
    maxProducts: 500,
    expiry: "never",
    category: "compliance",
  },
  {
    stripeId: STRIPE_PRODUCTS.SCAN_PACK_THREE,
    name: "Phoenix Scan Pack - 3",
    price: 129,
    billing: "one-time",
    description: "3 compliance scans.",
    scans: 3,
    maxProducts: 500,
    expiry: "1 year",
    category: "compliance",
  },
  {
    stripeId: STRIPE_PRODUCTS.SCAN_PACK_TEN,
    name: "Phoenix Scan Pack - 10",
    price: 399,
    billing: "one-time",
    description: "10 compliance scans.",
    scans: 10,
    maxProducts: 2000,
    expiry: "1 year",
    category: "compliance",
  },
  {
    stripeId: STRIPE_PRODUCTS.SCAN_PACK_TWENTY_FIVE,
    name: "Phoenix Scan Pack - 25",
    price: 899,
    billing: "one-time",
    description: "25 compliance scans.",
    scans: 25,
    maxProducts: 5000,
    expiry: "1 year",
    category: "compliance",
  },
];

export const BUNDLE_PRODUCTS: BundleProduct[] = [
  {
    stripeId: STRIPE_PRODUCTS.APP_WALKTHROUGH,
    name: "One-Off App Walkthrough",
    price: 75,
    description: "Guided onboarding session.",
    category: "bundle",
  },
];

export const TOTAL_STRIPE_PRODUCTS =
  SUBSCRIPTION_TIERS.length +
  COMPLIANCE_PRODUCTS.length +
  BUNDLE_PRODUCTS.length;
