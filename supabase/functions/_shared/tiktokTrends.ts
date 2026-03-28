interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export const Platform = {
  TIKTOK: "tiktok",
} as const;

export interface TrendKeyword {
  keyword: string;
  platform: (typeof Platform)[keyof typeof Platform];
  searchVolume: number;
  competitionLevel: "low" | "medium" | "high";
  isLongTail: boolean;
  isTitleWord: boolean;
  isTagWord: boolean;
  suggestedPlacement: "title" | "tags";
}

const readEnv = (key: string): string | null => Deno.env.get(key) ?? null;

export function hasTikTokTrendsEnv(): boolean {
  return Boolean(
    readEnv("TIKTOK_APP_KEY") &&
      readEnv("TIKTOK_APP_SECRET") &&
      readEnv("TIKTOK_ACCESS_TOKEN"),
  );
}

export function hasTikTokResearchEnv(): boolean {
  return Boolean(
    readEnv("TIKTOK_RESEARCH_ACCESS_TOKEN") ||
      (readEnv("TIKTOK_RESEARCH_CLIENT_KEY") &&
        readEnv("TIKTOK_RESEARCH_CLIENT_SECRET")),
  );
}

export function validateTikTokTrendsEnv() {
  const required = [
    "TIKTOK_APP_KEY",
    "TIKTOK_APP_SECRET",
    "TIKTOK_ACCESS_TOKEN",
  ];
  const missing = required.filter((key) => !readEnv(key));
  if (missing.length > 0) {
    throw new Error(
      `[TikTokTrends] Missing required env vars: ${missing.join(", ")}`,
    );
  }
}

const env = {
  appKey: () => readEnv("TIKTOK_APP_KEY") ?? "",
  appSecret: () => readEnv("TIKTOK_APP_SECRET") ?? "",
  accessToken: () => readEnv("TIKTOK_ACCESS_TOKEN") ?? "",
  researchKey: () => readEnv("TIKTOK_RESEARCH_CLIENT_KEY"),
  researchSec: () => readEnv("TIKTOK_RESEARCH_CLIENT_SECRET"),
  researchAccessToken: () => readEnv("TIKTOK_RESEARCH_ACCESS_TOKEN"),
  shopId: () => readEnv("TIKTOK_SHOP_ID") ?? "",
  region: () => readEnv("TIKTOK_DEFAULT_REGION") ?? "US",
  noCache: () => readEnv("TIKTOK_TRENDS_CACHE_DISABLED") === "true",
};

const SHOP_API = "https://open-api.tiktokglobalshop.com";
const OAUTH_API = "https://open.tiktokapis.com";
const RESEARCH_API = "https://open.tiktokapis.com/v2";

export interface TikTokTokenResponse {
  access_token: string;
  access_token_expire_in: number;
  expires_in: number;
  refresh_token: string;
  refresh_token_expire_in: number;
  refresh_expires_in: number;
}

export async function refreshTikTokToken(
  refreshToken: string,
): Promise<TikTokTokenResponse> {
  validateTikTokTrendsEnv();

  const merchantId = env.shopId();
  if (!merchantId) {
    throw new Error(
      "[TikTokTrends] TIKTOK_SHOP_ID is required to refresh a TikTok token",
    );
  }

  const body = new URLSearchParams({
    client_key: env.appKey(),
    client_secret: env.appSecret(),
    merchant_id: merchantId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch(`${OAUTH_API}/merchant/oauth/token/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-tt-target-idc": "alisg",
    },
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `[TikTokTrends] Token refresh failed: ${res.status}${
        detail ? ` - ${detail}` : ""
      }`,
    );
  }

  const data = await res.json() as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (
    !data.access_token || !data.refresh_token || !data.expires_in ||
    !data.refresh_expires_in
  ) {
    throw new Error(
      `[TikTokTrends] Token error: ${
        data.error_description ?? data.error ?? "unexpected response"
      }`,
    );
  }

  return {
    access_token: data.access_token,
    access_token_expire_in: data.expires_in,
    expires_in: data.expires_in,
    refresh_token: data.refresh_token,
    refresh_token_expire_in: data.refresh_expires_in,
    refresh_expires_in: data.refresh_expires_in,
  };
}

const memStore = new Map<string, CacheEntry<unknown>>();
let researchTokenCache: CacheEntry<string> | null = null;

const CACHE_TTL_MS = {
  trendingHashtags: 1 * 60 * 60 * 1000,
  keywordInsights: 6 * 60 * 60 * 1000,
  videoSearchTrends: 4 * 60 * 60 * 1000,
  hotProducts: 2 * 60 * 60 * 1000,
} as const;

type CacheType = keyof typeof CACHE_TTL_MS;

function ck(type: string, params: Record<string, string>) {
  const suffix = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return `tiktok_trends:${type}:${suffix}`;
}

function cacheGet<T>(key: string): T | null {
  if (env.noCache()) return null;

  const entry = memStore.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    memStore.delete(key);
    return null;
  }

  return entry.data;
}

function cacheSet<T>(key: string, data: T, type: CacheType) {
  if (env.noCache()) return;
  memStore.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS[type] });
}

const lastShop = { ts: 0 };
const lastKeyword = { ts: 0 };

async function getErrorText(res: Response): Promise<string> {
  return (await res.text().catch(() => "")).trim();
}

async function shopFetch(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: Record<string, string | number>,
) {
  validateTikTokTrendsEnv();

  const wait = 60 - (Date.now() - lastShop.ts);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastShop.ts = Date.now();

  const res = await fetch(`${SHOP_API}${path}`, {
    method,
    headers: {
      "x-tts-access-token": env.accessToken(),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return shopFetch(path, method, body);
  }

  if (!res.ok) {
    const detail = await getErrorText(res);
    throw new Error(
      `[TikTokTrends] Shop ${res.status}: ${path}${detail ? ` - ${detail}` : ""}`,
    );
  }

  return res;
}

async function keywordFetch(path: string, body: Record<string, string | number>) {
  validateTikTokTrendsEnv();

  const wait = 1200 - (Date.now() - lastKeyword.ts);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastKeyword.ts = Date.now();

  const res = await fetch(`${SHOP_API}${path}`, {
    method: "POST",
    headers: {
      "x-tts-access-token": env.accessToken(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    return keywordFetch(path, body);
  }

  if (!res.ok) {
    const detail = await getErrorText(res);
    throw new Error(
      `[TikTokTrends] Keyword ${res.status}: ${path}${
        detail ? ` - ${detail}` : ""
      }`,
    );
  }

  return res;
}

export interface TikTokHashtag {
  hashtag_name: string;
  hashtag_id: string;
  publish_cnt: number;
  video_views: number;
  trend: "up" | "down" | "stable";
}

export interface TikTokKeywordInsight {
  keyword: string;
  search_volume: number;
  volume_trend: number;
  competition_score: number;
  related_keywords: string[];
  top_categories: string[];
}

export interface TikTokProductHotItem {
  product_id: string;
  product_name: string;
  sold_count: number;
  click_through_rate: number;
  conversion_rate: number;
  category_name: string;
  price_range: { min: number; max: number; currency: string };
}

export interface TikTokVideoTrend {
  keyword: string;
  video_count: number;
  avg_play_rate: number;
  avg_engagement_rate: number;
  trending_sounds: string[];
  trending_hooks: string[];
}

interface TikTokResearchTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface TikTokResearchVideo {
  id: string | number;
  create_time?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  view_count?: number;
  music_id?: string | number;
  video_description?: string;
}

interface TikTokResearchVideoQueryResponse {
  data?: {
    videos?: TikTokResearchVideo[];
    cursor?: number;
    has_more?: boolean;
    search_id?: string;
  };
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
  };
}

function formatTikTokDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function roundTo(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function topStringValues(values: Array<string | null | undefined>, limit = 5): string[] {
  const counts = new Map<string, number>();

  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function extractHook(description?: string): string | null {
  const normalized = description?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const sentence = normalized.split(/[.!?]/)[0]?.trim() ?? normalized;
  const hook = sentence.length > 80
    ? `${sentence.slice(0, 77).trim()}...`
    : sentence;
  return hook || null;
}

async function getResearchAccessToken(): Promise<string> {
  const preissuedToken = env.researchAccessToken();
  if (preissuedToken) return preissuedToken;

  const cached = researchTokenCache;
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const clientKey = env.researchKey();
  const clientSecret = env.researchSec();
  if (!clientKey || !clientSecret) {
    throw new Error("[TikTokTrends] Research API credentials are not configured");
  }

  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  const res = await fetch(`${RESEARCH_API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json() as TikTokResearchTokenResponse;
  if (!res.ok || !data.access_token || !data.expires_in) {
    throw new Error(
      `[TikTokTrends] Research token error: ${
        data.error_description ?? data.error ?? res.status
      }`,
    );
  }

  researchTokenCache = {
    data: data.access_token,
    expiresAt: Date.now() + Math.max(data.expires_in - 60, 60) * 1000,
  };
  return data.access_token;
}

export interface TrendingHashtagsResult {
  region: string;
  category?: string;
  hashtags: TikTokHashtag[];
  fromCache: boolean;
  fetchedAt: Date;
}

export async function getTrendingHashtags(
  region?: string,
  category?: string,
): Promise<TrendingHashtagsResult> {
  const resolvedRegion = region ?? env.region();
  const key = ck("hashtags", {
    region: resolvedRegion,
    cat: category ?? "all",
  });
  const cached = cacheGet<TrendingHashtagsResult>(key);
  if (cached) return { ...cached, fromCache: true };

  const body: Record<string, string | number> = {
    region: resolvedRegion,
    page_size: 50,
  };
  if (category) body.category = category;

  const res = await shopFetch(
    "/product/202309/trends/hashtags/search",
    "POST",
    body,
  );
  const data = await res.json() as { data?: { hashtags?: TikTokHashtag[] } };

  const result: TrendingHashtagsResult = {
    region: resolvedRegion,
    category,
    hashtags: data.data?.hashtags ?? [],
    fromCache: false,
    fetchedAt: new Date(),
  };

  cacheSet(key, result, "trendingHashtags");
  return result;
}

export interface KeywordInsightsResult {
  keyword: string;
  region: string;
  insight: TikTokKeywordInsight | null;
  fromCache: boolean;
  fetchedAt: Date;
}

export async function getKeywordInsights(
  keyword: string,
  region?: string,
): Promise<KeywordInsightsResult> {
  const resolvedRegion = region ?? env.region();
  const key = ck("keyword", { kw: keyword, region: resolvedRegion });
  const cached = cacheGet<KeywordInsightsResult>(key);
  if (cached) return { ...cached, fromCache: true };

  const res = await keywordFetch("/product/202309/keyword/search", {
    keyword,
    region: resolvedRegion,
    page_size: 20,
  });
  const data = await res.json() as {
    data?: { keyword_list?: TikTokKeywordInsight[] };
  };

  const result: KeywordInsightsResult = {
    keyword,
    region: resolvedRegion,
    insight: data.data?.keyword_list?.[0] ?? null,
    fromCache: false,
    fetchedAt: new Date(),
  };

  cacheSet(key, result, "keywordInsights");
  return result;
}

export interface VideoTrendsResult {
  keyword: string;
  region: string;
  trend: TikTokVideoTrend | null;
  researchApiAvailable: boolean;
  fromCache: boolean;
  fetchedAt: Date;
}

export async function getVideoSearchTrends(
  keyword: string,
  region?: string,
): Promise<VideoTrendsResult> {
  const resolvedRegion = region ?? env.region();
  const key = ck("video", { kw: keyword, region: resolvedRegion });
  const cached = cacheGet<VideoTrendsResult>(key);
  if (cached) return { ...cached, fromCache: true };

  if (!hasTikTokResearchEnv()) {
    return {
      keyword,
      region: resolvedRegion,
      trend: null,
      researchApiAvailable: false,
      fromCache: false,
      fetchedAt: new Date(),
    };
  }

  const today = formatTikTokDate(new Date());
  const ago30 = formatTikTokDate(new Date(Date.now() - 30 * 864e5));
  const accessToken = await getResearchAccessToken();
  const fields = [
    "id",
    "create_time",
    "view_count",
    "like_count",
    "comment_count",
    "share_count",
    "music_id",
    "video_description",
  ].join(",");

  const res = await fetch(
    `${RESEARCH_API}/research/video/query/?fields=${
      encodeURIComponent(fields)
    }`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: {
          and: [
            {
              operation: "IN",
              field_name: "region_code",
              field_values: [resolvedRegion],
            },
            {
              operation: "EQ",
              field_name: "keyword",
              field_values: [keyword],
            },
          ],
        },
        start_date: ago30,
        end_date: today,
        max_count: 100,
        cursor: 0,
        is_random: false,
      }),
    },
  );

  const data = res.ok ? await res.json() as TikTokResearchVideoQueryResponse : null;
  const videos = data?.data?.videos ?? [];
  const totalViews = videos.reduce(
    (sum, video) => sum + (video.view_count ?? 0),
    0,
  );
  const totalEngagements = videos.reduce(
    (sum, video) =>
      sum + (video.like_count ?? 0) + (video.comment_count ?? 0) +
        (video.share_count ?? 0),
    0,
  );

  const trend = videos.length === 0
    ? null
    : {
      keyword,
      video_count: videos.length,
      avg_play_rate: Math.round(totalViews / videos.length),
      avg_engagement_rate: totalViews > 0
        ? roundTo((totalEngagements / totalViews) * 100, 2)
        : 0,
      trending_sounds: topStringValues(
        videos.map((video) => video.music_id != null ? String(video.music_id) : null),
      ),
      trending_hooks: topStringValues(
        videos.map((video) => extractHook(video.video_description)),
      ),
    };

  const result: VideoTrendsResult = {
    keyword,
    region: resolvedRegion,
    trend,
    researchApiAvailable: res.ok,
    fromCache: false,
    fetchedAt: new Date(),
  };

  cacheSet(key, result, "videoSearchTrends");
  return result;
}

export interface HotProductsResult {
  region: string;
  categoryId?: string;
  products: TikTokProductHotItem[];
  fromCache: boolean;
  fetchedAt: Date;
}

export async function getHotProducts(
  region?: string,
  categoryId?: string,
): Promise<HotProductsResult> {
  const resolvedRegion = region ?? env.region();
  const key = ck("hot", { region: resolvedRegion, cat: categoryId ?? "all" });
  const cached = cacheGet<HotProductsResult>(key);
  if (cached) return { ...cached, fromCache: true };

  const body: Record<string, string | number> = {
    region: resolvedRegion,
    page_size: 50,
    sort_by: "sold_count",
  };
  if (categoryId) body.category_id = categoryId;

  const res = await shopFetch(
    "/product/202309/trends/hot_products/search",
    "POST",
    body,
  );
  const data = await res.json() as { data?: { products?: TikTokProductHotItem[] } };

  const result: HotProductsResult = {
    region: resolvedRegion,
    categoryId,
    products: data.data?.products ?? [],
    fromCache: false,
    fetchedAt: new Date(),
  };

  cacheSet(key, result, "hotProducts");
  return result;
}

export function mapTikTokTrendsToKeywords(
  hashtags: TikTokHashtag[],
  keywordInsights: TikTokKeywordInsight[],
  existingTitle: string,
  existingTags: string[],
): TrendKeyword[] {
  const titleLower = existingTitle.toLowerCase();
  const tagsLower = existingTags.map((tag) => tag.toLowerCase());

  const fromHashtags: TrendKeyword[] = hashtags.map((hashtag) => {
    const keyword = hashtag.hashtag_name.replace(/^#/, "");
    const keywordLower = keyword.toLowerCase();

    return {
      keyword,
      platform: Platform.TIKTOK,
      searchVolume: hashtag.video_views,
      competitionLevel: hashtag.video_views > 10_000_000
        ? "high"
        : hashtag.video_views > 1_000_000
        ? "medium"
        : "low",
      isLongTail: keyword.split(/\s+/).length >= 3,
      isTitleWord: titleLower.includes(keywordLower),
      isTagWord: tagsLower.some((tag) => tag.includes(keywordLower)),
      suggestedPlacement: titleLower.includes(keywordLower)
        ? "tags"
        : keyword.split(/\s+/).length <= 2
        ? "title"
        : "tags",
    };
  });

  const fromKeywords: TrendKeyword[] = keywordInsights.map((insight) => {
    const keywordLower = insight.keyword.toLowerCase();

    return {
      keyword: insight.keyword,
      platform: Platform.TIKTOK,
      searchVolume: insight.search_volume,
      competitionLevel: insight.competition_score > 70
        ? "high"
        : insight.competition_score > 40
        ? "medium"
        : "low",
      isLongTail: insight.keyword.split(/\s+/).length >= 3,
      isTitleWord: titleLower.includes(keywordLower),
      isTagWord: tagsLower.some((tag) => tag.includes(keywordLower)),
      suggestedPlacement: titleLower.includes(keywordLower)
        ? "tags"
        : insight.keyword.split(/\s+/).length <= 2
        ? "title"
        : "tags",
    };
  });

  const seen = new Set<string>();
  return [...fromKeywords, ...fromHashtags].filter((keyword) => {
    const normalized = keyword.keyword.toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function clearTikTokTrendsCache() {
  for (const key of memStore.keys()) {
    if (key.startsWith("tiktok_trends:")) memStore.delete(key);
  }
}

export function getTikTokTrendsCacheStats() {
  const now = Date.now();
  let active = 0;
  let expired = 0;
  const keys: string[] = [];

  for (const [key, value] of memStore.entries()) {
    if (!key.startsWith("tiktok_trends:")) continue;

    if (now > value.expiresAt) {
      expired++;
      continue;
    }

    active++;
    keys.push(key);
  }

  return { active, expired, keys };
}
