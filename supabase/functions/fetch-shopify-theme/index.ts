import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
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

    const { connectionId } = await req.json();
    if (!connectionId) throw new Error("Missing connectionId");

    // Get store connection
    const { data: conn, error: connErr } = await supabase
      .from("store_connections")
      .select("*")
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .single();

    if (connErr || !conn) throw new Error("Store connection not found");
    if (conn.platform !== "shopify") throw new Error("Not a Shopify store");

    const shopDomain = conn.shop_domain;
    const accessToken = conn.access_token;

    // 1. Get the main/active theme
    const themesRes = await fetch(
      `https://${shopDomain}/admin/api/2024-01/themes.json`,
      { headers: { "X-Shopify-Access-Token": accessToken } }
    );
    const themesData = await themesRes.json();
    const mainTheme = themesData.themes?.find(
      (t: any) => t.role === "main"
    );
    if (!mainTheme) throw new Error("No active theme found");

    // 2. Pull key assets
    const assetKeys = [
      "layout/theme.liquid",
      "sections/footer.liquid",
      "sections/header.liquid",
      "assets/base.css",
      "config/settings_data.json",
      "templates/index.json",
    ];

    const assets: Record<string, string | null> = {};
    const scanIssues: string[] = [];

    for (const key of assetKeys) {
      try {
        const res = await fetch(
          `https://${shopDomain}/admin/api/2024-01/themes/${mainTheme.id}/assets.json?asset[key]=${encodeURIComponent(key)}`,
          { headers: { "X-Shopify-Access-Token": accessToken } }
        );
        if (res.ok) {
          const data = await res.json();
          assets[key] = data.asset?.value || null;
        } else {
          assets[key] = null;
        }
      } catch {
        assets[key] = null;
      }
    }

    // 3. Non-Judging Scan — detect common issues
    const themeLiquid = assets["layout/theme.liquid"] || "";
    const footerLiquid = assets["sections/footer.liquid"] || "";
    const baseCss = assets["assets/base.css"] || "";

    // Check for missing lazy loading
    const imgTags = (themeLiquid + footerLiquid).match(/<img[^>]*>/gi) || [];
    const unlazyImages = imgTags.filter(
      (t) => !t.includes('loading="lazy"') && !t.includes("loading='lazy'")
    );
    if (unlazyImages.length > 0) {
      scanIssues.push(
        `${unlazyImages.length} images missing lazy loading`
      );
    }

    // Check for hard-coded colors
    const hardcodedColors =
      baseCss.match(
        /#[0-9a-fA-F]{3,6}|rgb\([^)]+\)|rgba\([^)]+\)/g
      ) || [];
    if (hardcodedColors.length > 10) {
      scanIssues.push(
        `${hardcodedColors.length} hard-coded color values detected — should use CSS variables`
      );
    }

    // Check for missing legal footer anchors
    const hasPrivacyLink =
      footerLiquid.toLowerCase().includes("privacy") ||
      footerLiquid.toLowerCase().includes("policy");
    const hasTermsLink =
      footerLiquid.toLowerCase().includes("terms") ||
      footerLiquid.toLowerCase().includes("conditions");
    const hasRefundLink =
      footerLiquid.toLowerCase().includes("refund") ||
      footerLiquid.toLowerCase().includes("return");

    if (!hasPrivacyLink) scanIssues.push("Missing Privacy Policy link in footer");
    if (!hasTermsLink) scanIssues.push("Missing Terms of Service link in footer");
    if (!hasRefundLink) scanIssues.push("Missing Refund/Return Policy link in footer");

    // Check for unoptimized assets (inline styles, etc.)
    const inlineStyles =
      (themeLiquid + footerLiquid).match(/style="[^"]{50,}"/gi) || [];
    if (inlineStyles.length > 0) {
      scanIssues.push(`${inlineStyles.length} large inline styles detected`);
    }

    // Check for missing source tracking on forms
    const forms = (themeLiquid + footerLiquid).match(/<form[^>]*>[\s\S]*?<\/form>/gi) || [];
    const formsWithoutTracking = forms.filter(
      (f) => !f.includes("Source_ID") && !f.includes("source_id")
    );
    if (formsWithoutTracking.length > 0) {
      scanIssues.push(
        `${formsWithoutTracking.length} forms missing source tracking fields`
      );
    }

    // Detect blogs/sections for department mapping
    const blogMatches = themeLiquid.match(/blog[^"']*['"][^"']*['"]/gi) || [];
    const sectionFiles = Object.keys(assets).filter((k) =>
      k.startsWith("sections/")
    );

    const footerText = footerLiquid
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const legalEntityMatch =
      footerText.match(/(?:©|copyright)\s*(?:\d{4}\s*)?(.*?(?:LLC|INC|CORP(?:ORATION)?|LTD|CO\.?))/i) ||
      footerText.match(/(.*?(?:LLC|INC|CORP(?:ORATION)?|LTD|CO\.?))/i);
    const stateMatch =
      footerText.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/) ||
      footerText.match(/\b(?:California|New York|Texas|Florida|Wyoming|Washington|Oregon|Colorado)\b/i);
    const phoneMatch = footerText.match(/(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
    const supportLocationMatch = footerText.match(/(?:support|serving|located in|from)\s+([A-Za-z\s]+,\s*[A-Za-z]{2})/i);

    return new Response(
      JSON.stringify({
        themeId: mainTheme.id,
        themeName: mainTheme.name,
        assets,
        scanIssues,
        stats: {
          totalImages: imgTags.length,
          unlazyImages: unlazyImages.length,
          hardcodedColors: hardcodedColors.length,
          inlineStyles: inlineStyles.length,
          formsWithoutTracking: formsWithoutTracking.length,
          hasPrivacyLink,
          hasTermsLink,
          hasRefundLink,
        },
        blogs: blogMatches,
        sections: sectionFiles,
        detectedBusinessInfo: {
          legalEntityName: legalEntityMatch?.[1]?.trim() || conn.shop_name || "",
          stateOfIncorporation: stateMatch?.[0]?.trim() || "",
          supportLocation: supportLocationMatch?.[1]?.trim() || "",
          supportNumber: phoneMatch?.[1]?.trim() || "",
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


