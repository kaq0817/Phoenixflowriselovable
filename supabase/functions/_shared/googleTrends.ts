/**
 * Google Trends — real search signal for Phoenix Flow keyword optimization.
 *
 * Uses Google Trends' undocumented but stable JSON widget API (the same one
 * the google-trends-api npm package uses internally). No API key required.
 * Results are cached in-process for 4 hours to avoid rate limits.
 *
 * Returns:
 *   - Rising queries  — what's surging right now (breakout searches)
 *   - Top queries     — highest consistent volume for the seed keyword
 *
 * These are injected directly into the Gemini prompt as ground-truth
 * buyer intent signals, replacing guesswork with real search behavior.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrendQuery {
  query: string;
  value: string; // "Breakout" or numeric like "+250%"
  type: "rising" | "top";
}

export interface TrendsResult {
  keyword: string;
  rising: TrendQuery[];
  top: TrendQuery[];
  fetchedAt: string;
  source: "google_trends" | "fallback";
}

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: TrendsResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function cacheKey(keyword: string, geo: string): string {
  return `gt:${geo}:${keyword.toLowerCase().trim()}`;
}

// ─── Google Trends token fetch ────────────────────────────────────────────────

/**
 * Step 1: Get the widget token from Google Trends explore endpoint.
 * Google requires a two-step fetch: first get a "widget" token, then use it
 * to get the actual related queries data.
 */
async function getWidgetToken(
  keyword: string,
  geo: string,
): Promise<{ token: string; id: string } | null> {
  const params = new URLSearchParams({
    hl: "en-US",
    tz: "-300",
    req: JSON.stringify({
      comparisonItem: [
        {
          keyword,
          geo,
          time: "today 3-m", // last 90 days — recent enough to be actionable
        },
      ],
      category: 0,
      property: "",
    }),
  });

  const url = `https://trends.google.com/trends/api/explore?${params}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PhoenixFlow/1.0; +https://ironphoenixflow.com)",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://trends.google.com/",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    // Google prepends ")]}',\n" to prevent JSON hijacking — strip it
    const raw = await res.text();
    const json = JSON.parse(raw.replace(/^\)\]\}',?\n/, ""));

    // Find the RELATED_QUERIES widget
    const widgets: Array<{ id: string; token: string }> =
      json?.widgets ?? [];
    const widget = widgets.find((w) => w.id === "RELATED_QUERIES");
    if (!widget?.token) return null;

    return { token: widget.token, id: widget.id };
  } catch {
    return null;
  }
}

/**
 * Step 2: Use the widget token to fetch related queries.
 */
async function fetchRelatedQueries(
  token: string,
  geo: string,
): Promise<{ rising: TrendQuery[]; top: TrendQuery[] }> {
  const params = new URLSearchParams({
    hl: "en-US",
    tz: "-300",
    req: JSON.stringify({
      restriction: {
        geo: { country: geo },
        time: "today 3-m",
        originalTimeRangeForExploreUrl: "today 3-m",
      },
      keywordType: "QUERY",
      metric: ["TOP", "RISING"],
      trendinessSettings: { compareTime: "2024-09-01 2024-11-30" },
      requestOptions: { property: "", backend: "IZG", category: 0 },
      language: "en",
    }),
    token,
    user: "0",
  });

  const url = `https://trends.google.com/trends/api/widgetdata/relatedsearches?${params}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; PhoenixFlow/1.0; +https://ironphoenixflow.com)",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://trends.google.com/",
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return { rising: [], top: [] };

  const raw = await res.text();
  const json = JSON.parse(raw.replace(/^\)\]\}',?\n/, ""));

  const rankedList = json?.default?.rankedList ?? [];

  const rising: TrendQuery[] = [];
  const top: TrendQuery[] = [];

  for (const list of rankedList) {
    const isRising = list?.rankedKeyword?.[0]?.link?.includes("rising") ??
      false;
    const keywords: Array<{ query: string; value: number | string; formattedValue?: string }> =
      list?.rankedKeyword ?? [];

    for (const kw of keywords.slice(0, 10)) {
      const query = kw.query?.trim();
      if (!query) continue;

      const value =
        typeof kw.value === "number" && kw.value >= 5000
          ? "Breakout"
          : kw.formattedValue ?? String(kw.value ?? "");

      if (isRising) {
        rising.push({ query, value, type: "rising" });
      } else {
        top.push({ query, value, type: "top" });
      }
    }
  }

  return { rising, top };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Main entry point. Fetches Google Trends related queries for a keyword.
 *
 * @param keyword  Seed term (e.g. "gaming leggings", "patriotic apparel")
 * @param geo      ISO 3166-1 alpha-2 country code (default "US")
 * @returns        TrendsResult with rising + top queries, or empty fallback
 */
export async function getGoogleTrends(
  keyword: string,
  geo = "US",
): Promise<TrendsResult> {
  const key = cacheKey(keyword, geo);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const fallback: TrendsResult = {
    keyword,
    rising: [],
    top: [],
    fetchedAt: new Date().toISOString(),
    source: "fallback",
  };

  try {
    const widget = await getWidgetToken(keyword, geo);
    if (!widget) return fallback;

    const { rising, top } = await fetchRelatedQueries(widget.token, geo);

    const result: TrendsResult = {
      keyword,
      rising: rising.slice(0, 8),
      top: top.slice(0, 8),
      fetchedAt: new Date().toISOString(),
      source: "google_trends",
    };

    cache.set(key, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch {
    return fallback;
  }
}

/**
 * Fetch trends for multiple seed keywords in parallel (max 3 concurrent
 * to stay well under Google's rate limits).
 */
export async function getGoogleTrendsMulti(
  keywords: string[],
  geo = "US",
): Promise<TrendsResult[]> {
  // Batch into groups of 3
  const results: TrendsResult[] = [];
  const seeds = keywords.slice(0, 6); // cap at 6 seeds max

  for (let i = 0; i < seeds.length; i += 3) {
    const batch = seeds.slice(i, i + 3);
    const batchResults = await Promise.all(
      batch.map((kw) => getGoogleTrends(kw, geo)),
    );
    results.push(...batchResults);
    // Small delay between batches to be polite
    if (i + 3 < seeds.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return results;
}

/**
 * Format trends data as a compact string block to inject into Gemini prompts.
 * Designed to be tight — every token in the prompt costs money.
 */
export function formatTrendsForPrompt(results: TrendsResult[]): string {
  const lines: string[] = [];

  for (const r of results) {
    if (r.source === "fallback") continue;
    if (!r.rising.length && !r.top.length) continue;

    lines.push(`[Google Trends: "${r.keyword}"]`);

    if (r.rising.length) {
      lines.push(
        "  Rising (use these — buyers are searching them NOW):",
        ...r.rising.map((q) =>
          `    • "${q.query}"${q.value === "Breakout" ? " 🔥 BREAKOUT" : ` +${q.value}`}`
        ),
      );
    }

    if (r.top.length) {
      lines.push(
        "  Top (high consistent volume):",
        ...r.top.map((q) => `    • "${q.query}"`),
      );
    }

    lines.push("");
  }

  if (!lines.length) return "";

  return [
    "━━━ REAL GOOGLE SEARCH DATA (use these exact phrases) ━━━",
    ...lines,
    "Use the rising queries as tags/keywords — these are what buyers are actively searching right now.",
    "Breakout = search volume increased 5000%+ recently. Prioritize these above all else.",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

/**
 * Extract 2-3 seed keywords from a product for trends lookup.
 * Keeps seeds short and generic so Google Trends returns broad signal.
 */
export function extractTrendSeeds(
  productType: string,
  title: string,
  category?: string,
): string[] {
  const seeds = new Set<string>();

  // Use product type as primary seed (most reliable)
  if (productType?.trim()) {
    seeds.add(productType.trim().toLowerCase().slice(0, 40));
  }

  // Extract 2-3 word phrases from the title (avoid brand names and fluff)
  const NOISE = /\b(free|shipping|sale|new|best|hot|deal|our|phoenix|rise|iron|ghg|go|hard|gaming|discord|llc)\b/gi;
  const cleanTitle = title
    .replace(NOISE, " ")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleanTitle.split(" ").filter((w) => w.length > 3);

  // Build 2-word phrases from significant words
  if (words.length >= 2) {
    seeds.add(`${words[0]} ${words[1]}`.toLowerCase());
  }
  if (words.length >= 4) {
    seeds.add(`${words[2]} ${words[3]}`.toLowerCase());
  }

  // Category as fallback seed
  if (category?.trim() && seeds.size < 2) {
    seeds.add(category.trim().toLowerCase().slice(0, 40));
  }

  return Array.from(seeds).slice(0, 3);
}
