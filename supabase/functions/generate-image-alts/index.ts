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
  position?: number;
}

interface ImageAltResult {
  image_id: number;
  alt: string;
  filename: string;
}

async function fetchImageBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const mimeType = contentType.split(";")[0].trim();
    if (!mimeType.startsWith("image/")) return null;
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > 4 * 1024 * 1024) return null; // skip >4MB
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

// Process a batch of images through Gemini Vision
async function analyzeBatch(
  images: { id: number; index: number; base64: string; mimeType: string }[],
  productTitle: string,
  storeName: string,
  apiKey: string,
): Promise<ImageAltResult[]> {
  const storeSlug = slugify(storeName || "store") || "store";

  const imageParts = images.map((img) => ({
    inlineData: { mimeType: img.mimeType, data: img.base64 },
  }));

  const imageLabels = images.map((img, i) => `Image ${i + 1} (id: ${img.id})`).join(", ");

  const prompt = `You are an SEO image analyst for a Shopify store. Analyze each product image and generate GMC-compliant alt text and a clean SEO filename for it.

Product: "${productTitle}"
Store: "${storeName}"
Images provided: ${imageLabels}

For EACH image, look at what is actually visible — color, angle, detail, background, lifestyle context — and write:

ALT TEXT rules:
- Under 125 characters
- Format: "[What you see in the image] | ${storeName}"
- Describe the actual content: product color, angle (front, side, detail shot, lifestyle), key design elements
- Use keywords naturally — describe what's actually there, not generic labels
- No "image of", no "picture of", no vendor name "Iron Phoenix GHG"
- Image 1 = main/primary view; subsequent images = what makes THIS shot different (angle, detail, zoom, etc.)

FILENAME rules:
- All lowercase, hyphen-separated, no special chars, end in .jpg
- Format: "[product-descriptor]-[what-is-shown]-${storeSlug}.jpg"
- Describe what's in the shot: e.g. "rotating-soap-flower-rose-pink-main-${storeSlug}.jpg"
- No generic names like "image-1.jpg"

Return ONLY a JSON array, no explanation, no markdown:
[{"image_id": <id>, "alt": "<alt text>", "filename": "<filename>.jpg"}, ...]

One entry per image in the same order as provided.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini error ${response.status}`);
  }

  const data = await response.json();
  let raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "[]";
  raw = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ImageAltResult[];
  } catch { /* fall through */ }

  return [];
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

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("Gemini API key not configured");

    const { images, productTitle, storeName } = await req.json() as {
      images: ImageInput[];
      productTitle: string;
      storeName: string;
    };

    if (!images || images.length === 0) {
      return new Response(JSON.stringify({ error: "No images provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all images as base64 in parallel
    const fetched = await Promise.all(
      images.map(async (img, index) => {
        const result = await fetchImageBase64(img.src);
        if (!result) return null;
        return { id: img.id, index, base64: result.data, mimeType: result.mimeType };
      })
    );

    const validImages = fetched.filter((f): f is NonNullable<typeof f> => f !== null);

    // Process in batches of 8 to stay within Gemini's per-request limits
    const BATCH_SIZE = 8;
    const allResults: ImageAltResult[] = [];

    for (let i = 0; i < validImages.length; i += BATCH_SIZE) {
      const batch = validImages.slice(i, i + BATCH_SIZE);
      try {
        const batchResults = await analyzeBatch(batch, productTitle, storeName, GEMINI_API_KEY);
        allResults.push(...batchResults);
      } catch (err) {
        console.error(`Batch ${i / BATCH_SIZE + 1} failed:`, err);
        // Push fallback entries for failed batch images
        for (const img of batch) {
          allResults.push({
            image_id: img.id,
            alt: `${productTitle} - View ${img.index + 1} | ${storeName}`.slice(0, 125),
            filename: `${slugify(productTitle).slice(0, 40)}-view-${img.index + 1}-${slugify(storeName)}.jpg`,
          });
        }
      }
    }

    return new Response(JSON.stringify({ results: allResults }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
