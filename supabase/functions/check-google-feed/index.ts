import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { getShopifyApiVersion } from "../_shared/shopify.ts";

const SHOPIFY_API_VERSION = getShopifyApiVersion();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

// Values Google will reject or warn on
const VAGUE_COLOR_VALUES = new Set([
  "default", "default title", "n/a", "na", "none", "no color", "other",
  "os", "one size", "standard", "regular", "mixed", "assorted", "various",
  "multicolor", "multi", "color", "colour", "", ".", "-", "–", "—",
]);

interface ShopifyOption {
  id: number;
  name: string;
  position: number;
  values: string[];
}

interface ShopifyVariant {
  id: number;
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  price: string;
  sku: string;
  inventory_quantity: number;
}

interface ShopifyProduct {
  id: number;
  title: string;
  product_type: string;
  status: string;
  images: { src: string }[];
  options: ShopifyOption[];
  variants: ShopifyVariant[];
}

interface VariantIssue {
  variantId: number;
  variantTitle: string;
  issue: string;
  severity: "critical" | "warning";
}

interface ProductResult {
  productId: number;
  title: string;
  productType: string;
  status: string;
  image: string | null;
  colorOptionIndex: number | null; // which option position holds color (0=option1, 1=option2 ...)
  colorOptionName: string | null;
  issues: VariantIssue[];
  passCount: number;
  failCount: number;
  overallStatus: "pass" | "warning" | "fail";
}

function checkProduct(product: ShopifyProduct): ProductResult {
  const issues: VariantIssue[] = [];

  // Find the color option (case-insensitive)
  const colorOptIdx = product.options.findIndex(
    (o) => o.name.toLowerCase() === "color" || o.name.toLowerCase() === "colour"
  );

  const colorOptionName = colorOptIdx >= 0 ? product.options[colorOptIdx].name : null;
  const colorOptionKey = colorOptIdx >= 0 ? (`option${colorOptIdx + 1}` as keyof ShopifyVariant) : null;

  // Check if Color option exists at all
  if (colorOptIdx === -1) {
    // Only flag as critical if the product has multiple variants (single-variant products
    // without color still get flagged as a warning)
    const severity = product.variants.length > 1 ? "critical" : "warning";
    issues.push({
      variantId: 0,
      variantTitle: "(product level)",
      issue: `No "Color" option defined. Google requires a color attribute for all products in Shopping feeds. Add a "Color" option in Shopify.`,
      severity,
    });
  } else {
    // Color option exists — check each variant's color value
    for (const variant of product.variants) {
      const colorVal = colorOptionKey ? (variant[colorOptionKey] as string | null) : null;
      const normalized = (colorVal || "").trim().toLowerCase();

      if (!colorVal || normalized === "") {
        issues.push({
          variantId: variant.id,
          variantTitle: variant.title,
          issue: `Variant has an empty color value. Google will reject this product from Shopping.`,
          severity: "critical",
        });
      } else if (VAGUE_COLOR_VALUES.has(normalized)) {
        issues.push({
          variantId: variant.id,
          variantTitle: variant.title,
          issue: `Color value "${colorVal}" is too vague for Google Shopping. Use a real color name (e.g. "Black", "White", "Navy").`,
          severity: "warning",
        });
      } else if (colorVal.length > 100) {
        issues.push({
          variantId: variant.id,
          variantTitle: variant.title,
          issue: `Color value is over 100 characters. Google will truncate or reject it.`,
          severity: "warning",
        });
      }
    }

    // Check option name casing — Google prefers exactly "Color" not "Colour"
    if (colorOptionName && colorOptionName.toLowerCase() === "colour") {
      issues.push({
        variantId: 0,
        variantTitle: "(option name)",
        issue: `Option is named "Colour" — rename it to "Color" for best GMC compatibility.`,
        severity: "warning",
      });
    }
  }

  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount  = issues.filter((i) => i.severity === "warning").length;
  const passCount     = product.variants.length - issues.filter((i) => i.variantId !== 0).length;

  const overallStatus: ProductResult["overallStatus"] =
    criticalCount > 0 ? "fail" : warningCount > 0 ? "warning" : "pass";

  return {
    productId: product.id,
    title: product.title,
    productType: product.product_type,
    status: product.status,
    image: product.images?.[0]?.src || null,
    colorOptionIndex: colorOptIdx >= 0 ? colorOptIdx : null,
    colorOptionName,
    issues,
    passCount: Math.max(0, passCount),
    failCount: issues.filter((i) => i.variantId !== 0).length,
    overallStatus,
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { connectionId } = await req.json();
    if (!connectionId) {
      return new Response(JSON.stringify({ error: "connectionId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the connection belongs to this user
    const { data: connections } = await supabase
      .from("store_connections")
      .select("shop_domain, access_token")
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .eq("platform", "shopify")
      .limit(1);

    const connection = connections?.[0];
    if (!connection) throw new Error("Shopify connection not found");

    // Fetch all products with options + variants (paginate up to 250 per page)
    const allProducts: ShopifyProduct[] = [];
    let pageInfo: string | null = null;
    let page = 0;

    do {
      const url = new URL(
        `https://${connection.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/products.json`
      );
      url.searchParams.set("limit", "250");
      url.searchParams.set("fields", "id,title,product_type,status,images,options,variants");
      if (pageInfo) url.searchParams.set("page_info", pageInfo);

      const res = await fetch(url.toString(), {
        headers: { "X-Shopify-Access-Token": connection.access_token },
      });
      if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);

      const json = await res.json();
      allProducts.push(...(json.products || []));

      // Parse Link header for cursor-based pagination
      const linkHeader = res.headers.get("Link") || "";
      const nextMatch = linkHeader.match(/<[^>]*page_info=([^>&"]+)[^>]*>;\s*rel="next"/);
      pageInfo = nextMatch?.[1] || null;
      page++;
    } while (pageInfo && page < 20); // cap at 5000 products

    // Run checks
    const results = allProducts.map(checkProduct);

    const summary = {
      total: results.length,
      pass: results.filter((r) => r.overallStatus === "pass").length,
      warn: results.filter((r) => r.overallStatus === "warning").length,
      fail: results.filter((r) => r.overallStatus === "fail").length,
    };

    return new Response(JSON.stringify({ results, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Google feed check failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
