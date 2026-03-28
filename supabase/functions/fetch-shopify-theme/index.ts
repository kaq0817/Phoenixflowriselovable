import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import {
  analyzeThemeAssets,
  buildCollectionPillars,
  extractTemplateSectionKeys,
} from "../_shared/templanator.ts";

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

    const themesRes = await fetch(
      `https://${shopDomain}/admin/api/2024-01/themes.json`,
      { headers: { "X-Shopify-Access-Token": accessToken } }
    );
    const themesData = await themesRes.json();
    const mainTheme = themesData.themes?.find((theme: { role?: string }) => theme.role === "main");
    if (!mainTheme) throw new Error("No active theme found");

    const baseAssetKeys = [
      "layout/theme.liquid",
      "sections/footer.liquid",
      "sections/header.liquid",
      "assets/base.css",
      "config/settings_data.json",
      "templates/index.json",
    ];

    const assets: Record<string, string | null> = {};

    for (const key of baseAssetKeys) {
      assets[key] = await fetchThemeAsset({
        shopDomain,
        accessToken,
        themeId: mainTheme.id,
        key,
      });
    }

    const sectionAssetKeys = extractTemplateSectionKeys(assets["templates/index.json"]);
    for (const key of sectionAssetKeys) {
      if (key in assets) continue;
      assets[key] = await fetchThemeAsset({
        shopDomain,
        accessToken,
        themeId: mainTheme.id,
        key,
      });
    }

    const collectionPillars = buildCollectionPillars(
      await fetchCollections({ shopDomain, accessToken }),
    );

    const analysis = analyzeThemeAssets({
      assets,
      collectionPillars,
      shopDomain,
      shopName: conn.shop_name,
    });

    return new Response(
      JSON.stringify({
        themeId: mainTheme.id,
        themeName: mainTheme.name,
        assets,
        scanIssues: analysis.scanIssues,
        stats: analysis.stats,
        blogs: analysis.blogs,
        sections: analysis.sections,
        detectedBusinessInfo: analysis.detectedBusinessInfo,
        lcpCandidate: analysis.lcpCandidate,
        policyLinks: analysis.policyLinks,
        collectionPillars: analysis.collectionPillars,
        crossStoreLinks: analysis.crossStoreLinks,
        supportSiloStatus: analysis.supportSiloStatus,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function fetchThemeAsset(input: {
  shopDomain: string;
  accessToken: string;
  themeId: number;
  key: string;
}): Promise<string | null> {
  try {
    const res = await fetch(
      `https://${input.shopDomain}/admin/api/2024-01/themes/${input.themeId}/assets.json?asset[key]=${encodeURIComponent(input.key)}`,
      { headers: { "X-Shopify-Access-Token": input.accessToken } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.asset?.value || null;
  } catch {
    return null;
  }
}

async function fetchCollections(input: {
  shopDomain: string;
  accessToken: string;
}): Promise<Array<{ title?: string; handle?: string; products_count?: number }>> {
  const responses = await Promise.all([
    fetch(`https://${input.shopDomain}/admin/api/2024-01/custom_collections.json?limit=250`, {
      headers: { "X-Shopify-Access-Token": input.accessToken },
    }),
    fetch(`https://${input.shopDomain}/admin/api/2024-01/smart_collections.json?limit=250`, {
      headers: { "X-Shopify-Access-Token": input.accessToken },
    }),
  ]);

  const collections: Array<{ title?: string; handle?: string; products_count?: number }> = [];
  for (const response of responses) {
    if (!response.ok) continue;
    const data = await response.json();
    if (Array.isArray(data.custom_collections)) {
      collections.push(...data.custom_collections);
    }
    if (Array.isArray(data.smart_collections)) {
      collections.push(...data.smart_collections);
    }
  }

  return collections;
}
