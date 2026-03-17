import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
      nichePalette,
    } = businessInfo;

    const systemPrompt = `You are the Phoenix Flow Templanator — an expert Shopify theme engineer.
You receive raw Liquid/CSS theme files and business configuration data, then output REWRITTEN versions.

RULES:
1. ARCHITECTURE: Rewrite the footer to include a Legal Anchor section that clearly separates the LLC entity from the brand.
   - Add: "© ${new Date().getFullYear()} ${legalEntityName || "Company"}, ${stateOfIncorporation || "State"}. All rights reserved."
   - Add navigation links for Privacy Policy, Terms of Service, and Refund Policy pages (link to /policies/privacy-policy, /policies/terms-of-service, /policies/refund-policy)
   - DO NOT write or modify actual policy content — only add the navigation links
   - Add support info: "${supportLocation || ""}" and "${supportNumber || ""}"

2. SPEED: 
   - Add loading="lazy" to ALL <img> tags that don't already have it
   - Add loading="lazy" decoding="async" to images
   - Remove excessive inline styles and move them to CSS variables
   - Add rel="preconnect" for external font/CDN domains in theme.liquid head

3. SOURCE TRACKING:
   - Find all <form> tags and inject a hidden field: <input type="hidden" name="contact[Source_ID]" value="phoenix-flow-tracked">
   - This ensures forwarded form submissions are never "mystery" emails

4. IDENTITY (CSS):
   - Replace hard-coded hex colors with CSS custom properties where possible
   - If a niche palette is provided, apply it to --color-primary, --color-secondary, --color-accent variables
${nichePalette ? `   - Niche Palette: ${nichePalette}` : ""}

5. DEPARTMENT TAGGING:
${departmentMappings && departmentMappings.length > 0 ? departmentMappings.map((d: any) => `   - Blog/Section "${d.name}" → Department: "${d.department}"`).join("\n") : "   - No department mappings provided"}

6. DO NOT:
   - Write, modify, or generate privacy policies, terms of service, or refund policies
   - Remove existing functionality
   - Break Liquid template syntax
   - Add JavaScript tracking/analytics scripts

Return a JSON object with keys matching the asset paths, each containing the rewritten file content.
Only include files that were actually modified. If a file needs no changes, omit it.

Format: { "layout/theme.liquid": "...", "sections/footer.liquid": "...", "assets/base.css": "..." }`;

    const userPrompt = `Here are the current theme files to rewrite:

${Object.entries(assets)
  .filter(([_, v]) => v)
  .map(([k, v]) => `=== ${k} ===\n${v}`)
  .join("\n\n")}

Business Configuration:
- Legal Entity: ${legalEntityName || "N/A"}
- State: ${stateOfIncorporation || "N/A"}
- Support Location: ${supportLocation || "N/A"}
- Support Number: ${supportNumber || "N/A"}
- Niche Palette: ${nichePalette || "Default"}

Fix types requested: ${(fixTypes || ["architecture", "speed", "tracking", "identity"]).join(", ")}

Return ONLY the JSON object with modified file contents. No markdown, no explanation.`;

    console.log("Calling Gemini for theme rewrite preview...");

    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 30000,
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

    console.log(`Preview generated: ${Object.keys(rewrittenFiles).length} files rewritten`);

    // PREVIEW ONLY — do NOT push to Shopify
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
