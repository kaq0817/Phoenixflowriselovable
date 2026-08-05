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
    "Place the exact product in a realistic, inviting lifestyle scene where a shopper would naturally use it. Avoid a blank white catalog background.",
  human:
    "Show one believable adult naturally wearing, holding, or using the exact product. Keep the product fully visible and make the scene feel like a premium ecommerce photograph.",
  styled:
    "Create a styled close-up ecommerce scene with useful environmental context, natural depth, and room around the product. The exact product remains the hero.",
};

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

    const { connectionId, productId, imageId, sourceNote = "", style = "lifestyle" } = await req.json();
    if (!connectionId || !productId || !imageId || !styleDirections[style]) {
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
    const sourceImage = (product.images || []).find((image: { id: number }) => Number(image.id) === Number(imageId));
    if (!sourceImage?.src) throw new Error("The selected Shopify image was not found");

    const sourceResponse = await fetch(sourceImage.src);
    if (!sourceResponse.ok) throw new Error("Phoenix Flow could not read the selected product image");
    const sourceBytes = new Uint8Array(await sourceResponse.arrayBuffer());
    if (sourceBytes.byteLength > MAX_SOURCE_BYTES) throw new Error("The selected image is too large for mockup generation");
    const sourceMime = sourceResponse.headers.get("content-type")?.split(";")[0] || "image/jpeg";

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
    generationForm.append("image[]", new Blob([sourceBytes], { type: sourceMime }), `source-${imageId}`);
    generationForm.append("size", "1024x1024");
    generationForm.append("quality", "low");
    generationForm.append("output_format", "webp");
    generationForm.append("output_compression", "84");

    const generationResponse = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}` },
      body: generationForm,
    });
    if (!generationResponse.ok) {
      console.error("OpenAI mockup generation failed:", await generationResponse.text());
      throw new Error("OpenAI could not create this mockup");
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
