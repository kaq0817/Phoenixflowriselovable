import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

interface ImageInput {
  id: number;
  src: string;
}

interface ImageAltResult {
  image_id: number;
  alt: string;
  filename: string;
}

function isGenericAlt(value: string): boolean {
  const normalized = value
    .split("|")[0]
    .trim()
    .toLowerCase();
  return (
    /^product image(?:\s+\d+)?$/.test(normalized) ||
    /^image(?:\s+\d+)?$/.test(normalized) ||
    /^(product|item)(\s+(image|photo|view|detail))?(\s+\d+)?$/.test(normalized)
  );
}

async function fetchImageBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const imageUrl = new URL(url);
    if (imageUrl.hostname.includes("cdn.shopify.com")) {
      imageUrl.searchParams.set("width", "1200");
    }
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const mimeType = contentType.split(";")[0].trim();
    if (!mimeType.startsWith("image/")) return null;
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > 10 * 1024 * 1024) return null;
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return { data: btoa(binary), mimeType };
  } catch {
    return null;
  }
}

function slugify(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .trim();
}

// Analyze ONE image — no product title in the prompt so the model must use its eyes
async function analyzeOneImage(
  imageId: number,
  base64: string,
  mimeType: string,
  storeName: string,
  storeSlug: string,
  openAiApiKey: string,
): Promise<ImageAltResult> {
  const prompt = `You are a Google Merchant Center compliance auditor. GMC will SUSPEND this listing if the image alt text does not accurately describe what is PHYSICALLY VISIBLE in the image.

Your only job: look at this image and describe exactly what you see.

RULES — violation = GMC suspension:
1. LOOK AT THE IMAGE. Do not guess based on context. Do not invent. Do not copy a product title.
2. Identify the specific object in the image: is it a necklace? a ring? a red box? a soap flower? a gift bag? a bottle? Describe THAT specific thing.
3. Note the color, material, and angle if visible.
4. Do NOT use generic words like "product", "item", "view", "detail". Name the actual object.
5. Do NOT include vendor names like "Iron Phoenix", "Iron Phoenix GHG".
6. Alt text must be under 125 characters. Format: "[object] [color/detail] [angle] | ${storeName}"
7. Filename: all lowercase, hyphens only, ends in .webp. Format: "[object]-[color]-[angle]-${storeSlug}.webp"

Examples of CORRECT output:
- alt: "Silver rose pendant necklace on white background | ${storeName}"  filename: "silver-rose-pendant-necklace-front-${storeSlug}.webp"
- alt: "Pink soap flower in red heart gift box open lid | ${storeName}"   filename: "pink-soap-flower-red-heart-gift-box-${storeSlug}.webp"
- alt: "Gold rotating jewelry display stand close-up | ${storeName}"     filename: "gold-rotating-jewelry-display-stand-${storeSlug}.webp"

Return ONLY this JSON object, nothing else:
{"image_id": ${imageId}, "alt": "<your alt text>", "filename": "<your filename>.webp"}`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          {
            type: "input_image",
            image_url: `data:${mimeType};base64,${base64}`,
            detail: "low",
          },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "shopify_image_alt",
          strict: true,
          schema: {
            type: "object",
            properties: {
              image_id: { type: "number" },
              alt: { type: "string" },
              filename: { type: "string" },
            },
            required: ["image_id", "alt", "filename"],
            additionalProperties: false,
          },
        },
      },
      max_output_tokens: 256,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${await response.text().then(t => t.slice(0, 160))}`);
  }

  const data = await response.json();
  const raw = (data.output || [])
    .flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content || [])
    .find((item: { type?: string }) => item.type === "output_text")
    ?.text?.trim() || "";

  try {
    const parsed = JSON.parse(raw);
    if (parsed.image_id && parsed.alt && parsed.filename && !isGenericAlt(String(parsed.alt))) {
      return {
        image_id: parsed.image_id,
        alt: String(parsed.alt).slice(0, 125),
        filename: String(parsed.filename),
      };
    }
  } catch { /* fall through */ }

  throw new Error("The image scanner did not return a specific visual description");
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
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured");

    const { images, storeName } = await req.json() as {
      images: ImageInput[];
      productTitle?: string; // accepted but intentionally not used in vision prompt
      storeName: string;
    };

    if (!images || images.length === 0) {
      return new Response(JSON.stringify({ error: "No images provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const storeSlug = slugify(storeName || "store") || "store";

    // Fetch all images in parallel
    const fetched = await Promise.all(
      images.map(async (img, index) => {
        const result = await fetchImageBase64(img.src);
        if (!result) return { id: img.id, index, failed: true as const };
        return { id: img.id, index, failed: false as const, base64: result.data, mimeType: result.mimeType };
      })
    );

    // Process each image individually — one OpenAI vision call per image for accuracy
    // Run in parallel batches of 5 to balance speed vs. rate limits
    const CONCURRENCY = 5;
    const allResults: ImageAltResult[] = [];
    const failedImageIds: number[] = [];

    for (let i = 0; i < fetched.length; i += CONCURRENCY) {
      const chunk = fetched.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (img) => {
          if (img.failed) {
            failedImageIds.push(img.id);
            return null;
          }
          try {
            return await analyzeOneImage(img.id, img.base64, img.mimeType, storeName, storeSlug, OPENAI_API_KEY);
          } catch (error) {
            console.error(`Alt scan failed for image ${img.id}:`, error);
            failedImageIds.push(img.id);
            return null;
          }
        })
      );
      allResults.push(...chunkResults.filter((result): result is ImageAltResult => result !== null));
    }

    return new Response(JSON.stringify({
      results: allResults,
      failedImageIds,
      message: failedImageIds.length > 0
        ? `${failedImageIds.length} image${failedImageIds.length === 1 ? "" : "s"} could not be scanned. Existing alt text was preserved.`
        : undefined,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
