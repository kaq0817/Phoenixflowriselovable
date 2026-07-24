import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { getShopifyApiVersion } from "../_shared/shopify.ts";

const SHOPIFY_API_VERSION = getShopifyApiVersion();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

function domainToStoreName(domain: string | null | undefined): string {
  if (!domain) return "";
  return domain
    .replace(/\.myshopify\.com$/i, "")
    .replace(/\.[a-z]{2,}$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function enforceUniqueAltTexts(
  edits: Record<string, string>,
  shopLabel: string,
): Record<string, string> {
  const entries = Object.entries(edits)
    .sort(([a], [b]) => Number(a) - Number(b));

  const used = new Set<string>();
  const unique: Record<string, string> = {};

  for (let i = 0; i < entries.length; i += 1) {
    const [imageId, inputAlt] = entries[i];
    const raw = `${inputAlt || ""}`.trim();
    if (!raw) continue;
    const description = raw.split("|")[0].trim().toLowerCase();
    if (
      /^product image(?:\s+\d+)?$/.test(description) ||
      /^image(?:\s+\d+)?$/.test(description) ||
      /^(product|item)(\s+(image|photo|view|detail))?(\s+\d+)?$/.test(description)
    ) {
      console.warn(`Skipped generic alt text for image ${imageId}`);
      continue;
    }

    const [leftRaw, rightRaw] = raw.split("|");
    const left = leftRaw.trim();
    const right = (rightRaw || "").trim() || shopLabel;

    let candidate = right ? `${left} | ${right}` : left;
    let normalized = candidate.toLowerCase();

    if (used.has(normalized)) {
      const detail = i === 0 ? "Primary View" : `Detail ${i + 1}`;
      candidate = right ? `${left} - ${detail} | ${right}` : `${left} - ${detail}`;
      normalized = candidate.toLowerCase();
    }

    let suffix = 2;
    while (used.has(normalized)) {
      candidate = right ? `${left} - Detail ${i + 1}-${suffix} | ${right}` : `${left} - Detail ${i + 1}-${suffix}`;
      normalized = candidate.toLowerCase();
      suffix += 1;
    }

    used.add(normalized);
    unique[imageId] = candidate.slice(0, 512);
  }

  return unique;
}

type FaqItem = { question: string; answer: string };

function parseFaqItems(value: unknown): FaqItem[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error("FAQ must be a list of questions and answers");

  const items = parsed
    .map((item) => ({
      question: typeof item?.question === "string" ? item.question.trim() : "",
      answer: typeof item?.answer === "string" ? item.answer.trim() : "",
    }))
    .filter((item) => item.question && item.answer);

  if (items.length === 0) throw new Error("FAQ has no valid questions and answers");
  return items;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function faqValueForField(items: FaqItem[], fieldType: string): string {
  if (fieldType === "rich_text_field") {
    return JSON.stringify({
      type: "root",
      children: items.flatMap((item) => [
        {
          type: "paragraph",
          children: [{ type: "text", value: item.question, bold: true }],
        },
        {
          type: "paragraph",
          children: [{ type: "text", value: item.answer }],
        },
      ]),
    });
  }

  // The store's FAQ tab renders this metaobject text as HTML. Details elements
  // stay compact on a product page and work without theme JavaScript.
  return items
    .map((item) =>
      `<details class="product-faq-item"><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`
    )
    .join("\n");
}

async function updateReferencedFaqMetaobject(input: {
  shop: string;
  accessToken: string;
  productMetafields: Array<{
    type?: string;
    value?: string;
  }>;
  faqItems: FaqItem[];
}): Promise<{ id: string; handle: string }> {
  const referencedIds = new Set<string>();

  for (const metafield of input.productMetafields) {
    if (!metafield.type?.includes("metaobject_reference") || !metafield.value) continue;
    if (metafield.type.startsWith("list.")) {
      try {
        const values = JSON.parse(metafield.value);
        if (Array.isArray(values)) {
          for (const value of values) {
            if (typeof value === "string") referencedIds.add(value);
          }
        }
      } catch { /* ignore a malformed reference list */ }
    } else {
      referencedIds.add(metafield.value);
    }
  }

  if (referencedIds.size === 0) {
    throw new Error("This product does not have a referenced Shopify FAQ metaobject");
  }

  const graphqlUrl = `https://${input.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const graphql = async (query: string, variables: Record<string, unknown>) => {
    const response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": input.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const body = await response.json();
    if (!response.ok || body.errors?.length) {
      const message = body.errors?.map((error: { message?: string }) => error.message).filter(Boolean).join("; ");
      throw new Error(message || "Shopify could not read the FAQ metaobject");
    }
    return body.data;
  };

  const candidateData = await graphql(
    `query FindFaqMetaobjects($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Metaobject {
          id
          type
          handle
          fields { key type }
        }
      }
    }`,
    { ids: [...referencedIds] },
  );

  const candidates = (candidateData?.nodes || []).filter(
    (node: { id?: string; type?: string; fields?: Array<{ key: string; type: string }> } | null) =>
      node?.id && Array.isArray(node.fields) && node.fields.length > 0,
  );
  const faqMetaobject = candidates.find(
    (node: { type?: string; fields: Array<{ key: string; type: string }> }) =>
      /faq/i.test(node.type || "") && node.fields.some((field) =>
        field.key.toLowerCase() === "faq" || field.type === "multi_line_text_field"
      ),
  ) || candidates.find(
    (node: { fields: Array<{ key: string; type: string }> }) =>
      node.fields.some((field) => field.key.toLowerCase() === "faq"),
  );

  if (!faqMetaobject) {
    throw new Error("Phoenix Flow found the product's metaobjects, but none matches the FAQ entry");
  }

  const faqField = faqMetaobject.fields.find(
    (field: { key: string; type: string }) => field.key.toLowerCase() === "faq",
  ) || faqMetaobject.fields.find(
    (field: { key: string; type: string }) => field.type === "multi_line_text_field",
  ) || (faqMetaobject.fields.length === 1 ? faqMetaobject.fields[0] : null);

  if (!faqField) {
    throw new Error("Phoenix Flow found the FAQ entry, but could not identify its text field");
  }
  const faqValue = faqValueForField(input.faqItems, faqField.type);
  const updateData = await graphql(
    `mutation UpdateProductFaq($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id handle }
        userErrors { field message code }
      }
    }`,
    {
      id: faqMetaobject.id,
      metaobject: { fields: [{ key: faqField.key, value: faqValue }] },
    },
  );

  const result = updateData?.metaobjectUpdate;
  if (result?.userErrors?.length) {
    throw new Error(result.userErrors.map((error: { message: string }) => error.message).join("; "));
  }
  if (!result?.metaobject) throw new Error("Shopify did not update the FAQ metaobject");
  return result.metaobject;
}

serve(async (req) => {
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
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { productId, optimizedData, connectionId, imageAltEdits } = await req.json();
    if (!productId || !optimizedData) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let connectionQuery = supabase
      .from("store_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("platform", "shopify")
      .order("created_at", { ascending: false })
      .limit(1);

    if (connectionId) {
      connectionQuery = connectionQuery.eq("id", connectionId);
    }

    const { data: connectionRows, error: connErr } = await connectionQuery;
    const connection = connectionRows?.[0];

    if (connErr || !connection) {
      return new Response(JSON.stringify({ error: "No Shopify connection found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shop = connection.shop_domain;
    const accessToken = connection.access_token;
    const shopLabel: string = connection.shop_name || domainToStoreName(connection.shop_domain) || "";

    // Build update payload
    const updateBody: Record<string, unknown> = {};
    if (optimizedData.title) updateBody.title = optimizedData.title;
    if (optimizedData.body_html) updateBody.body_html = optimizedData.body_html;
    if (optimizedData.product_type) updateBody.product_type = optimizedData.product_type;
    if (optimizedData.tags) updateBody.tags = optimizedData.tags;
    if (optimizedData.url_handle) updateBody.handle = optimizedData.url_handle;

    // Update product via Shopify API
    const updateRes = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}.json`,
      {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ product: { id: productId, ...updateBody } }),
      }
    );

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error("Shopify update failed:", errText);
      return new Response(JSON.stringify({ error: "Failed to update product on Shopify" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch existing metafields once, then upsert each one
    const existingMfRes = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}/metafields.json`,
      { headers: { "X-Shopify-Access-Token": accessToken } }
    );
    const existingMfData = existingMfRes.ok ? await existingMfRes.json() : { metafields: [] };
    const existingMetafields: {
      id: number;
      namespace: string;
      key: string;
      type?: string;
      value?: string;
    }[] = existingMfData.metafields || [];

    const findMetafield = (namespace: string, key: string) =>
      existingMetafields.find((m) => m.namespace === namespace && m.key === key);

    const upsertMetafield = async (namespace: string, key: string, value: string, type: string) => {
      const existing = findMetafield(namespace, key);
      const url = existing
        ? `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/metafields/${existing.id}.json`
        : `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}/metafields.json`;
      const method = existing ? "PUT" : "POST";
      const payload = {
        metafield: {
          ...(existing ? { id: existing.id } : { namespace, key, type }),
          value,
        },
      };
      const res = await fetch(url, {
        method,
        headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorBody = await res.text();
        console.error(`Failed to ${method} metafield ${namespace}.${key}:`, errorBody);
      }
    };

    if (optimizedData.seo_title) {
      await upsertMetafield("global", "title_tag", optimizedData.seo_title, "single_line_text_field");
    }
    if (optimizedData.seo_description) {
      await upsertMetafield("global", "description_tag", optimizedData.seo_description, "single_line_text_field");
    }
    let updatedFaqMetaobject: { id: string; handle: string } | null = null;
    if (optimizedData.faq_json) {
      updatedFaqMetaobject = await updateReferencedFaqMetaobject({
        shop,
        accessToken,
        productMetafields: existingMetafields,
        faqItems: parseFaqItems(optimizedData.faq_json),
      });
    }

    // Update image alt text — prefer explicit imageAltEdits map, fall back to optimizedData.image_alts JSON string
    let resolvedAltEdits: Record<string, string> | null = null;
    if (imageAltEdits && typeof imageAltEdits === "object") {
      resolvedAltEdits = imageAltEdits as Record<string, string>;
    } else if (optimizedData.image_alts && typeof optimizedData.image_alts === "string") {
      try {
        const parsed: { image_id: number; alt: string }[] = JSON.parse(optimizedData.image_alts);
        if (Array.isArray(parsed)) {
          resolvedAltEdits = {};
          for (const entry of parsed) {
            if (typeof entry.image_id === "number" && entry.alt) {
              resolvedAltEdits[String(entry.image_id)] = entry.alt;
            }
          }
        }
      } catch { /* ignore malformed image_alts */ }
    }
    if (resolvedAltEdits) {
      const uniqueAltEdits = enforceUniqueAltTexts(resolvedAltEdits, shopLabel);
      for (const [imageId, altText] of Object.entries(uniqueAltEdits)) {
        if (!altText) continue;
        await fetch(
          `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}/images/${imageId}.json`,
          {
            method: "PUT",
            headers: {
              "X-Shopify-Access-Token": accessToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ image: { id: Number(imageId), alt: altText } }),
          }
        );
      }
    }

    const updatedProduct = await updateRes.json();

    return new Response(JSON.stringify({
      success: true,
      product: updatedProduct.product,
      faqMetaobject: updatedFaqMetaobject,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("apply-shopify-changes error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

