import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SAFE_REWRITE_KEYS = new Set(["sections/footer.liquid"]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { connectionId, themeId, assets, businessInfo, fixTypes } = await req.json();

    if (!connectionId || !themeId || !assets || !businessInfo)
      throw new Error("Missing required fields");

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) throw new Error("AI key not configured");

    const {
      legalEntityName,
      stateOfIncorporation,
      supportLocation,
      supportNumber,
      departmentMappings,
    } = businessInfo;

    const footerAsset = assets["sections/footer.liquid"];
    if (!footerAsset || typeof footerAsset !== "string") {
      throw new Error("Footer asset not available");
    }

    const systemPrompt = `You are the Phoenix Flow Templanator, an expert Shopify theme engineer.
You must produce a SMALL, SAFE edit to sections/footer.liquid only.

Rules:
1. Keep all existing Liquid logic and structure unless a tiny local edit is required.
2. You may add a legal/policy links block to the footer.
3. You may add support text to the footer.
4. If a form exists inside the footer, you may add a hidden Source_ID field there only.
5. Do not rewrite the whole file when a small insertion works.
6. Do not touch performance, scripts, global CSS, layout/theme.liquid, templates, or settings JSON.
7. Do not modify privacy policy content, terms content, or refund policy content.
8. Return valid JSON only in the format: { "sections/footer.liquid": "..." }.
9. If no safe change is needed, return {}.`;

    const userPrompt = `Current footer file:
=== sections/footer.liquid ===
${footerAsset}

Business Configuration:
- Legal Entity: ${legalEntityName || "N/A"}
- State: ${stateOfIncorporation || "N/A"}
- Support Location: ${supportLocation || "N/A"}
- Support Number: ${supportNumber || "N/A"}
- Department Mappings: ${JSON.stringify(departmentMappings || [])}
- Fix types requested: ${(fixTypes || ["architecture"]).join(", ")}

Return ONLY the JSON object.`;

    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 12000,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    const aiData = await aiRes.json();
    const aiText = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

    let rewrittenFiles: Record<string, string>;
    try {
      rewrittenFiles = JSON.parse(aiText);
    } catch {
      const jsonMatch = aiText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        rewrittenFiles = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error("AI returned invalid JSON response");
      }
    }

    rewrittenFiles = Object.fromEntries(
      Object.entries(rewrittenFiles).filter(([key, value]) => SAFE_REWRITE_KEYS.has(key) && typeof value === "string" && value.trim().length > 0)
    );

    return new Response(
      JSON.stringify({
        success: true,
        rewrittenFiles,
        totalModified: Object.keys(rewrittenFiles).length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("apply-theme-fixes error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
