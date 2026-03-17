/**
 * PHOENIX FLOW: STRIPE PRODUCT CATALOG
 * Source: Stripe products CSV export — 2026-03-12
 * DO NOT MODIFY PRICES — these match live Stripe products
 */

// ============================================================================
// STRIPE PRODUCT IDS + PRICE IDS
// ============================================================================

export const STRIPE_PRODUCTS = {
  // Subscriptions
  BASIC: "prod_U8Ql8O4CAH7EtR",
  BASIC_YEARLY: "prod_U8RZnmJGxnQ0Jw",
  PRO: "prod_U8Qnc3mKuDjHU3",
  PREMIUM_MONTHLY: "prod_U8Sl0IykdxvN7q",
  PREMIUM_YEARLY: "prod_U8So6Vf7BsyU4e",
  AGENCY_MONTHLY: "prod_U8RC6wioPFz5uX",
  AGENCY_ANNUAL: "prod_U8TEHkXHb8naio",
  AGENCY_ELITE: "prod_U8R7QcJ1QjKfhj",

  // Compliance
  COMPLIANCE_BUSINESS: "prod_U8RlNjLt4R5CSJ",
  SINGLE_COMPLIANCE: "prod_U8RnwNAWiMyF4K",
  THREE_SCAN_PACK: "prod_U8QrfgnjxMJ4ic",
  TEN_SCAN_PACK: "prod_U8QqVYXsk6RbRK",
  TWENTY_FIVE_SCAN_PACK: "prod_U8QpzRv9aJUZXC",

  // One-offs / Bundles
  APP_WALKTHROUGH: "prod_U8RnJY32kFCGcB",
  ETSY_BUNDLE: "prod_U8QkDuYfmta0pw",
  SHOPIFY_SEO: "prod_U8Qj5CkVlGruLm",

  // Enterprise (to be created in Stripe)
  ENTERPRISE_MONTHLY: "",
  ENTERPRISE_YEARLY: "",
} as const;

/** Stripe Price IDs — verified against live Stripe account 2026-03-15 */
export const STRIPE_PRICES: Record<string, string> = {
  // Basic Monthly $12
  [STRIPE_PRODUCTS.BASIC]: "price_1TA9uJGUZx3v4iGjJzKwS65d",
  // Basic Yearly $100
  [STRIPE_PRODUCTS.BASIC_YEARLY]: "price_1TAAgUGUZx3v4iGjzGu5XLeA",
  // Pro Monthly $24
  [STRIPE_PRODUCTS.PRO]: "price_1TA9vVGUZx3v4iGjs5QT1i1p",
  // Premium Monthly $39
  [STRIPE_PRODUCTS.PREMIUM_MONTHLY]: "price_1TABq5GUZx3v4iGj7CqTHaUj",
  // Premium Yearly $399
  [STRIPE_PRODUCTS.PREMIUM_YEARLY]: "price_1TABsWGUZx3v4iGjHz3ZVmuo",
  // Agency Monthly $1999
  [STRIPE_PRODUCTS.AGENCY_MONTHLY]: "price_1TAAKMGUZx3v4iGjxG8I2oGO",
  // Agency Annual $19990
  [STRIPE_PRODUCTS.AGENCY_ANNUAL]: "price_1TACIUGUZx3v4iGjk5hL2ytz",
  // Agency Elite $1990/yr
  [STRIPE_PRODUCTS.AGENCY_ELITE]: "price_1TAAF5GUZx3v4iGjnjpWl8Mq",

  // Compliance
  [STRIPE_PRODUCTS.COMPLIANCE_BUSINESS]: "price_1TAAs3GUZx3v4iGjmy5YutRI",
  [STRIPE_PRODUCTS.SINGLE_COMPLIANCE]: "price_1TAAtdGUZx3v4iGj6HGyl4me",
  [STRIPE_PRODUCTS.THREE_SCAN_PACK]: "price_1TA9zvGUZx3v4iGj3fq3UexX",
  [STRIPE_PRODUCTS.TEN_SCAN_PACK]: "price_1TA9ywGUZx3v4iGj3hyqKg3d",
  [STRIPE_PRODUCTS.TWENTY_FIVE_SCAN_PACK]: "price_1TA9y2GUZx3v4iGju7eCWtQE",

  // Bundles
  [STRIPE_PRODUCTS.APP_WALKTHROUGH]: "price_1TAAuMGUZx3v4iGjMc0lSu3L",
  [STRIPE_PRODUCTS.ETSY_BUNDLE]: "price_1TA9sqGUZx3v4iGjvoznpjmm",
  [STRIPE_PRODUCTS.SHOPIFY_SEO]: "price_1TA9rzGUZx3v4iGjwPF9fCQg",
};

// ============================================================================
// SUBSCRIPTION TIERS (Monthly + Yearly where applicable)
// ============================================================================

export interface SubscriptionTier {
  stripeId: string;
  name: string;
  price: number;
  billing: "monthly" | "yearly" | "6-months";
  description: string;
  stores: number;
  category: "subscription";
}

export const SUBSCRIPTION_TIERS: SubscriptionTier[] = [
  // FREE (no Stripe product — internal)
  {
    stripeId: "",
    name: "Free Trial",
    price: 0,
    billing: "6-months",
    description: "5 free operations to test. Store verification required. 1 store limit.",
    stores: 1,
    category: "subscription",
  },

  // BASIC
  {
    stripeId: STRIPE_PRODUCTS.BASIC,
    name: "Phoenix Flow - Essential (Basic)",
    price: 12,
    billing: "monthly",
    description:
      "Ideal for: Sellers only interested in core listing data like tags, materials, and descriptions.",
    stores: 1,
    category: "subscription",
  },
  {
    stripeId: STRIPE_PRODUCTS.BASIC_YEARLY,
    name: "Phoenix Flow - Basic Yearly",
    price: 100,
    billing: "yearly",
    description:
      "Price: $100/yr (Save $44!). No refunds once the 6th operation activates. Includes: Free Test: First 5 operations are free. 1 Store: Supports Shopify or Etsy. 50 AI Descriptions/mo: Monthly content limit. One-Time Use: Limited to one session per store. SEO: Full automated optimization. Bulk Edit: 5 items at once. Support: Email assistance. Note: Results depend on your marketing.",
    stores: 1,
    category: "subscription",
  },

  // PRO
  {
    stripeId: STRIPE_PRODUCTS.PRO,
    name: "Pro ($24/mo)",
    price: 24,
    billing: "monthly",
    description:
      "Advanced optimization and multi-store sync. 50 products up to 3 stores",
    stores: 3,
    category: "subscription",
  },

  // PREMIUM
  {
    stripeId: STRIPE_PRODUCTS.PREMIUM_MONTHLY,
    name: "Phoenix Flow - Premium Monthly",
    price: 39,
    billing: "monthly",
    description:
      "Pro Power for Multi-Store Owners BILLING: First 5 operations FREE. $39/mo auto-renews (cancel anytime). NO REFUNDS: After your 6th operation, all sales are final. We optimize products; sales depend on your marketing. INCLUDES: Up to 10 stores (Shopify/Etsy) 500 AI product descriptions/mo 50 AI music video scripts/mo 100 AI ad concepts/mo Bulk editing (25 products at once) White-label option Analytics dashboard Priority 24h support",
    stores: 10,
    category: "subscription",
  },
  {
    stripeId: STRIPE_PRODUCTS.PREMIUM_YEARLY,
    name: "Phoenix Flow - Premium Yearly",
    price: 399,
    billing: "yearly",
    description:
      "BILLING: First 5 ops FREE. $399/yr billed annually (cancel anytime). NO REFUNDS: After 6th operation, payment is final. We deliver optimization—sales depend on your marketing. INCLUDES: Unlimited stores (Shopify/Etsy) 500 AI product descriptions/mo 50 AI music video scripts/mo 100 AI ad concepts/mo Bulk editing (25 at once) White-label option Priority support (12-hour response)",
    stores: -1,
    category: "subscription",
  },

  // AGENCY ELITE
  {
    stripeId: STRIPE_PRODUCTS.AGENCY_ELITE,
    name: "Phoenix Flow - Agency Elite",
    price: 299,
    billing: "monthly",
    description:
      "8 Store Slots with multi-tenant capacity. Compliance Suite with Google sales and customer trust scans. White-Label branding for logos/reports. 6h priority email support. All activations are final; partial months are not pro-rated.",
    stores: 8,
    category: "subscription",
  },
  {
    stripeId: STRIPE_PRODUCTS.AGENCY_ANNUAL,
    name: "Phoenix Flow - Agency Elite (Annual)",
    price: 2990,
    billing: "yearly",
    description:
      'Annual Agency Elite — 8 stores. Monthly Refresh: 8 Deep Scans/mo (1 per store), 24 Light Scans/mo (3 per store). Counters reset on billing cycle date.',
    stores: 8,
    category: "subscription",
  },

  // ENTERPRISE
  {
    stripeId: STRIPE_PRODUCTS.ENTERPRISE_MONTHLY,
    name: "Phoenix Flow - Enterprise",
    price: 1999,
    billing: "monthly",
    description:
      "Enterprise plan for 40 stores with dedicated account manager, custom integrations, SLA guarantees, white-label, API access, and priority 1-hour support.",
    stores: 40,
    category: "subscription",
  },
  {
    stripeId: STRIPE_PRODUCTS.ENTERPRISE_YEARLY,
    name: "Phoenix Flow - Enterprise (Annual)",
    price: 19999,
    billing: "yearly",
    description:
      "Enterprise annual plan for 40 stores with dedicated account manager, custom integrations, SLA guarantees, white-label, API access, and priority 1-hour support.",
    stores: 40,
    category: "subscription",
  },
];

// ============================================================================
// COMPLIANCE PRODUCTS
// ============================================================================

export interface ComplianceProduct {
  stripeId: string;
  name: string;
  price: number | null; // null = price not in CSV
  billing: "monthly" | "one-time";
  description: string;
  scans: number;
  maxProducts: number;
  expiry: string;
  category: "compliance";
}

export const COMPLIANCE_PRODUCTS: ComplianceProduct[] = [
  {
    stripeId: STRIPE_PRODUCTS.COMPLIANCE_BUSINESS,
    name: "Compliance Business (Monthly)",
    price: null,
    billing: "monthly",
    description: "25 scans per month (up to 5,000 products), scans reset monthly",
    scans: 25,
    maxProducts: 5000,
    expiry: "monthly reset",
    category: "compliance",
  },
  {
    stripeId: STRIPE_PRODUCTS.SINGLE_COMPLIANCE,
    name: "Single Compliance Scan",
    price: null,
    billing: "one-time",
    description: "1 compliance scan (up to 500 products), credits never expire",
    scans: 1,
    maxProducts: 500,
    expiry: "never",
    category: "compliance",
  },
  {
    stripeId: STRIPE_PRODUCTS.THREE_SCAN_PACK,
    name: "3 compliance scans",
    price: null,
    billing: "one-time",
    description: "3 compliance scans (up to 500 products each) expires after 1 yr",
    scans: 3,
    maxProducts: 500,
    expiry: "1 year",
    category: "compliance",
  },
  {
    stripeId: STRIPE_PRODUCTS.TEN_SCAN_PACK,
    name: "10-Compliance Scan Pack",
    price: null,
    billing: "one-time",
    description: "10 compliance scans (up to 2,000 products each), expire 1 yr.",
    scans: 10,
    maxProducts: 2000,
    expiry: "1 year",
    category: "compliance",
  },
  {
    stripeId: STRIPE_PRODUCTS.TWENTY_FIVE_SCAN_PACK,
    name: "25-Scan Pack (Best Value)",
    price: null,
    billing: "one-time",
    description: "25 compliance scans (up to 5,000 products each) expire 1 year",
    scans: 25,
    maxProducts: 5000,
    expiry: "1 year",
    category: "compliance",
  },
];

// ============================================================================
// ONE-OFF / BUNDLE PRODUCTS
// ============================================================================

export interface BundleProduct {
  stripeId: string;
  name: string;
  price: number | null;
  description: string;
  category: "bundle";
}

export const BUNDLE_PRODUCTS: BundleProduct[] = [
  {
    stripeId: STRIPE_PRODUCTS.APP_WALKTHROUGH,
    name: "One-Off App Walkthrough",
    price: null,
    description: "",
    category: "bundle",
  },
  {
    stripeId: STRIPE_PRODUCTS.ETSY_BUNDLE,
    name: "Etsy Optimization Bundle",
    price: null,
    description:
      "Includes the 8-Second Narrative Framework for video scripts, noun-first titles, and utilizing all 13 tags with multi-word long-tail phrases.",
    category: "bundle",
  },
  {
    stripeId: STRIPE_PRODUCTS.SHOPIFY_SEO,
    name: "Shopify SEO Automation",
    price: null,
    description:
      "This covers the 9-Section Optimization Framework, including front-loading focus keywords in titles and enforcing a 900–1,100 character long-form description.",
    category: "bundle",
  },
];

// ============================================================================
// TOTAL PRODUCT COUNT
// ============================================================================

export const TOTAL_STRIPE_PRODUCTS =
  SUBSCRIPTION_TIERS.length +
  COMPLIANCE_PRODUCTS.length +
  BUNDLE_PRODUCTS.length;
