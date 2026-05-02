import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import {
  analyzeThemeAssets,
  buildCollectionPillars,
  extractTemplateSectionKeys,
} from "../_shared/templanator.ts";
import { getShopifyApiVersion } from "../_shared/shopify.ts";

const SHOPIFY_API_VERSION = getShopifyApiVersion();

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
      `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/themes.json`,
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
    const shopifyDomains = await fetchShopifyDomains({ shopDomain, accessToken });
    const { blogs, articles } = await fetchArticles({ shopDomain, accessToken });

    const analysis = analyzeThemeAssets({
      assets,
      collectionPillars,
      articles,
      blogs,
      shopifyDomains,
      shopDomain,
      shopName: conn.shop_name,
    });
    const riskArticles = buildRiskArticles(articles, analysis.contentRisks);

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
        contentRisks: analysis.contentRisks,
        contentArticleCount: articles.length,
        riskArticles,
        shopifyDomains,
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
      `https://${input.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/themes/${input.themeId}/assets.json?asset[key]=${encodeURIComponent(input.key)}`,
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
    fetch(`https://${input.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/custom_collections.json?limit=250`, {
      headers: { "X-Shopify-Access-Token": input.accessToken },
    }),
    fetch(`https://${input.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/smart_collections.json?limit=250`, {
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

async function fetchShopifyDomains(input: {
  shopDomain: string;
  accessToken: string;
}): Promise<string[]> {
  try {
    const response = await fetch(
      `https://${input.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/domains.json`,
      { headers: { "X-Shopify-Access-Token": input.accessToken } },
    );
    if (!response.ok) return [];

    const data = await response.json();
    const domains = Array.isArray(data.domains) ? data.domains : [];
    return domains
      .map((domain: { host?: string }) => String(domain.host || "").trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchArticles(input: {
  shopDomain: string;
  accessToken: string;
}): Promise<{
  blogs: string[];
  articles: Array<{
    id?: number;
    blog_id?: number;
    title?: string;
    handle?: string;
    blog_title?: string;
    tags?: string;
    body_html?: string;
    summary_html?: string;
  }>;
}> {
  try {
    const [blogsRes, articlesRes] = await Promise.all([
      fetch(
        `https://${input.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/blogs.json?limit=250&fields=id,title,handle`,
        { headers: { "X-Shopify-Access-Token": input.accessToken } },
      ),
      fetch(
        `https://${input.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/articles.json?limit=250&fields=id,title,handle,blog_id,tags,body_html,summary_html`,
        { headers: { "X-Shopify-Access-Token": input.accessToken } },
      ),
    ]);
    if (!blogsRes.ok || !articlesRes.ok) return { blogs: [], articles: [] };

    const blogsData = await blogsRes.json();
    const articlesData = await articlesRes.json();
    const blogs = (Array.isArray(blogsData.blogs) ? blogsData.blogs : [])
      .map((blog: { title?: string; handle?: string }) => String(blog.title || blog.handle || "").trim())
      .filter(Boolean);
    const blogMap = new Map<number, string>(
      (Array.isArray(blogsData.blogs) ? blogsData.blogs : []).map((blog: { id: number; title?: string }) => [blog.id, String(blog.title || "").trim()]),
    );

    const articles = (Array.isArray(articlesData.articles) ? articlesData.articles : []).map((article: {
      id?: number;
      title?: string;
      handle?: string;
      blog_id?: number;
      tags?: string;
      body_html?: string;
      summary_html?: string;
    }) => ({
      id: article.id,
      blog_id: article.blog_id,
      title: article.title,
      handle: article.handle,
      blog_title: blogMap.get(Number(article.blog_id || 0)) || "",
      tags: article.tags,
      body_html: article.body_html,
      summary_html: article.summary_html,
    }));

    return { blogs, articles };
  } catch {
    return { blogs: [], articles: [] };
  }
}

function buildRiskArticles(
  articles: Array<{
    id?: number;
    blog_id?: number;
    title?: string;
    handle?: string;
    blog_title?: string;
    tags?: string;
    body_html?: string;
    summary_html?: string;
  }>,
  contentRisks: Array<{ handle: string }>,
): Array<{
  articleId: number;
  blogId: number;
  title: string;
  handle: string;
  blogTitle: string;
  tags: string;
  summaryHtml: string;
  bodyHtml: string;
}> {
  const flaggedHandles = new Set(
    contentRisks
      .map((risk) => String(risk.handle || "").trim())
      .filter((value) => value.length > 0),
  );

  if (flaggedHandles.size === 0) return [];

  const seen = new Set<string>();
  const riskArticles: Array<{
    articleId: number;
    blogId: number;
    title: string;
    handle: string;
    blogTitle: string;
    tags: string;
    summaryHtml: string;
    bodyHtml: string;
  }> = [];

  for (const article of articles) {
    const handle = String(article.handle || "").trim();
    const articleId = Number(article.id || 0);
    const blogId = Number(article.blog_id || 0);
    if (!handle || !flaggedHandles.has(handle) || articleId <= 0 || blogId <= 0) continue;
    if (seen.has(handle)) continue;
    seen.add(handle);

    riskArticles.push({
      articleId,
      blogId,
      title: String(article.title || handle || "Untitled article").trim(),
      handle,
      blogTitle: String(article.blog_title || "").trim(),
      tags: String(article.tags || "").trim(),
      summaryHtml: String(article.summary_html || ""),
      bodyHtml: String(article.body_html || ""),
    });
  }

  return riskArticles;
}
