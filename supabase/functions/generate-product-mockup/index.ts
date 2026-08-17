import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { getShopifyApiVersion } from "../_shared/shopify.ts";
import { buildMockupContextNote } from "../_shared/mockupPromptHelpers.ts";

const SHOPIFY_API_VERSION = getShopifyApiVersion();
const MAX_SOURCE_BYTES = 12_000_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

const styleDirections: Record<string, string> = {
  lifestyle:
    "Place the exact product in a realistic, inviting lifestyle scene styled to feel gift-worthy and desirable — the kind of shot that makes a shopper want to buy it for themselves or give it as a present. Where it fits the product naturally, include tasteful gift-giving staging around the product — loose ribbon, tissue paper, wrapping paper, or a gift bag arranged as if a shopper is about to wrap or present it themselves — without hiding or overwhelming the product. This is staging only: never show the product already sealed inside a box, sleeve, or wrapped parcel, and never imply any box, wrapping, or packaging ships with or is included in the purchase — the product itself must remain fully visible and unpackaged. Use warm, flattering, editorial-style lighting and a setting that feels curated and intentional for this specific product, not a generic backdrop. Avoid a blank white catalog background.",
  human:
    "Show one believable adult naturally wearing, holding, or using the exact product. Keep the product fully visible and make the scene feel like a premium ecommerce photograph. The person must have completely normal, anatomically correct proportions — exactly two arms and two legs, correctly jointed hands with five fingers each, no fused, missing, extra, or malformed limbs. Frame the shot (e.g. cropped at the waist or thigh, or focused on the hands and torso) so that any limb shown is fully and cleanly visible rather than awkwardly cut off. If you cannot render the person with correct anatomy, favor a tighter crop over showing more of the body.",
  styled:
    "Create a styled close-up ecommerce scene with useful environmental context, natural depth, and room around the product, framed to feel premium and gift-ready — like a boutique product photo shot to sell, not a plain product-on-a-surface shot. Where it fits the product naturally, a hint of gift-giving staging (loose ribbon, tissue paper, wrapping paper in frame) is welcome as long as it stays secondary and the product stays fully visible and unpackaged — this is mood staging only, never a sealed box or parcel, and never implies packaging is included in the purchase. The exact product remains the hero.",
};

const GENERIC_SCENE_BAN =
  "Do not default to the generic AI-staged-apartment look (rattan/wicker planter with a leafy houseplant, jute or sisal rug, beige linen couch corner, bare white wall). Choose props, surface, and background color that are specific and intentional for this exact product instead of a templated interior corner.";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      connectionId,
      productId,
      imageId,
      sourceAttachment = "",
      sourceMimeType = "",
      sourceFilename = "",
      sourceNote = "",
      style = "lifestyle",
    } = await req.json();
    const hasShopifySource = Boolean(imageId);
    const hasTemporarySource = typeof sourceAttachment === "string" && sourceAttachment.length > 0;
    if (!connectionId || !productId || (!hasShopifySource && !hasTemporarySource) || !styleDirections[style]) {
      return new Response(JSON.stringify({ error: "Missing or invalid mockup details" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: connections, error: connectionError } = await supabase
      .from("store_connections")
      .select("shop_domain, access_token")
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .eq("platform", "shopify")
      .limit(1);
    const connection = connections?.[0];
    if (connectionError || !connection) throw new Error("Shopify connection not found");

    const productResponse = await fetch(
      `https://${connection.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/products/${Number(productId)}.json`,
      { headers: { "X-Shopify-Access-Token": connection.access_token } },
    );
    if (!productResponse.ok) throw new Error("Phoenix Flow could not load this Shopify product");
    const { product } = await productResponse.json();
    let sourceBytes: Uint8Array;
    let sourceMime: string;
    let safeSourceFilename: string;

    if (hasTemporarySource) {
      if (sourceAttachment.length > 16_500_000) {
        throw new Error("The uploaded POD source image is too large");
      }
      const allowedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
      sourceMime = allowedMimeTypes.has(sourceMimeType) ? sourceMimeType : "image/jpeg";
      try {
        sourceBytes = Uint8Array.from(atob(sourceAttachment), (character) => character.charCodeAt(0));
      } catch {
        throw new Error("Phoenix Flow could not read the uploaded POD source image");
      }
      if (sourceBytes.byteLength === 0 || sourceBytes.byteLength > MAX_SOURCE_BYTES) {
        throw new Error("The uploaded POD source image must be under 12 MB");
      }
      safeSourceFilename = `${sourceFilename || "pod-source-image"}`
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .slice(0, 100) || "pod-source-image";
    } else {
      const sourceImage = (product.images || []).find((image: { id: number }) => Number(image.id) === Number(imageId));
      if (!sourceImage?.src) throw new Error("The selected Shopify image was not found");

      const sourceResponse = await fetch(sourceImage.src);
      if (!sourceResponse.ok) throw new Error("Phoenix Flow could not read the selected product image");
      sourceBytes = new Uint8Array(await sourceResponse.arrayBuffer());
      if (sourceBytes.byteLength > MAX_SOURCE_BYTES) throw new Error("The selected image is too large for mockup generation");
      sourceMime = sourceResponse.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      safeSourceFilename = `shopify-source-${imageId}`;
    }

    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiKey) throw new Error("OpenAI image generation is not configured");

    const cleanSourceNote = typeof sourceNote === "string"
      ? sourceNote.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300)
      : "";
    const sourceNoteBlock = cleanSourceNote
      ? `\nMERCHANT SOURCE IMAGE NOTE:\n"${cleanSourceNote}"\nTreat this note as the correct product orientation. If it says the image shows the back, keep the artwork on the back and pose the product or person so the back is visible. Never move back artwork to the front.\n`
      : "";
    const productContextNote = buildMockupContextNote({
      title: product.title,
      product_type: product.product_type,
      tags: product.tags,
    });

    const prompt = `Create one square, photorealistic Shopify lifestyle mockup for "${product.title}".

${styleDirections[style]}
${style === "human" ? "" : GENERIC_SCENE_BAN}
${productContextNote}
${sourceNoteBlock}

PRODUCT PRESERVATION IS THE HIGHEST PRIORITY:
- Use the supplied image as the exact product reference, not loose inspiration.
- Do not redraw, rewrite, paraphrase, replace, mirror, crop away, or invent any artwork, lettering, logo, pattern, product color, shape, or construction.
- Any visible printed words must remain letter-for-letter identical and face the correct direction.
- Do not add sale text, badges, borders, watermarks, captions, or unrelated products.
- If the reference is a flat supplier mockup, improve the surrounding scene while keeping the sellable product recognizable and accurate.
- Use realistic scale, hands, anatomy, lighting, shadows, fabric folds, and perspective.
- The result must look like a genuine premium ecommerce photograph, not an AI illustration.`;

    const generationForm = new FormData();
    generationForm.append("model", "gpt-image-2");
    generationForm.append("prompt", prompt);
    generationForm.append("image[]", new Blob([sourceBytes], { type: sourceMime }), safeSourceFilename);
    generationForm.append("size", "1024x1024");
    generationForm.append("quality", style === "human" ? "high" : "medium");
    generationForm.append("output_format", "webp");
    generationForm.append("output_compression", "84");

    const generationResponse = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}` },
      body: generationForm,
    });
    if (!generationResponse.ok) {
      const errText = await generationResponse.text();
      console.error("OpenAI mockup generation failed:", errText);
      let detail = errText;
      try {
        const parsed = JSON.parse(errText) as { error?: { message?: string } };
        detail = parsed.error?.message || errText;
      } catch {
        // Not JSON — use the raw text.
      }
      throw new Error(`OpenAI could not create this mockup: ${detail.slice(0, 200)}`);
    }
    const generation = await generationResponse.json();
    const generatedBase64 = generation?.data?.[0]?.b64_json;
    if (!generatedBase64) throw new Error("OpenAI did not return a mockup image");

    return new Response(JSON.stringify({
      mockup: {
        data: generatedBase64,
        mimeType: "image/webp",
        style,
        quality: {
          approved: false,
          issues: ["Compare the product, lettering, artwork, colors, and direction with the source before approving."],
        },
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mockup generation failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
