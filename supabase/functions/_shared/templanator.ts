export interface ThemeBusinessInfo {
  legalEntityName?: string;
  stateOfIncorporation?: string;
  supportLocation?: string;
  supportNumber?: string;
  paletteSelection?: {
    id?: string;
    colors?: string[];
  };
  pillarPalettes?: Record<string, { id?: string; colors?: string[] }>;
}

export interface ThemeLcpCandidate {
  assetKey: string;
  tag: string;
  source: string;
  sourceFingerprint: string;
  sourceExpression?: string;
  loadingMode: "eager" | "lazy" | "missing" | "other";
  hasFetchPriorityHigh: boolean;
  preloadDetected: boolean;
}

export interface ThemePolicyLink {
  label: string;
  targetPath: string;
  href: string | null;
  status: "ok" | "missing" | "dead-link-risk";
}

export interface ThemeLeak {
  assetKey: string;
  domain: string;
  url: string;
}

export interface CollectionPillar {
  title: string;
  handle: string;
  productsCount: number;
  suggestedSubdomain: string;
}

export interface ThemeAnalysis {
  scanIssues: string[];
  stats: {
    totalImages: number;
    unlazyImages: number;
    hardcodedColors: number;
    inlineStyles: number;
    formsWithoutTracking: number;
    hasPrivacyLink: boolean;
    hasTermsLink: boolean;
    hasRefundLink: boolean;
    belowFoldImagesMissingLazy: number;
    crossStoreLinkCount: number;
  };
  blogs: string[];
  sections: string[];
  detectedBusinessInfo: ThemeBusinessInfo;
  lcpCandidate: ThemeLcpCandidate | null;
  policyLinks: ThemePolicyLink[];
  collectionPillars: CollectionPillar[];
  crossStoreLinks: ThemeLeak[];
  supportSiloStatus: {
    expectedStoreMarker: string | null;
    matchesLocation: boolean;
    matchesPhoneContext: boolean;
  };
}

export type ThemeFixMode = "all" | "lcp" | "domains" | "remaining";

interface ImageCandidate {
  assetKey: string;
  tag: string;
  source: string;
  sourceFingerprint: string;
  sourceExpression?: string;
  hasLazyLoading: boolean;
  hasEagerLoading: boolean;
  hasFetchPriorityHigh: boolean;
  rank: number;
}

interface CollectionInput {
  title?: string;
  handle?: string;
  products_count?: number;
}

const POLICY_TARGETS = [
  { label: "Privacy Policy", targetPath: "/policies/privacy-policy", matchers: [/privacy/i] },
  { label: "Terms of Service", targetPath: "/policies/terms-of-service", matchers: [/terms/i, /conditions/i] },
  { label: "Refund Policy", targetPath: "/policies/refund-policy", matchers: [/refund/i, /return/i] },
] as const;

const SAFE_EXTERNAL_DOMAINS = new Set([
  "cdn.shopify.com",
  "fonts.shopifycdn.com",
  "shop.app",
  "ourphoenixrise.com",
  "gohardgaming.com",
  "www.gohardgaming.com",
  "ironphoenix.store",
  "www.ironphoenix.store",
  "shadowseekers-forge.creator-spring.com",
  "www.shadowseekers-forge.creator-spring.com",
  "ironphoenixghg.store",
  "pixelchicbotreasures.etsy.com",
  "ironphoenixghg.etsy.com",
  "gohardgamingdiscord.printify.me",
  "googletagmanager.com",
  "www.googletagmanager.com",
  "tagmanager.google.com",
  "google-analytics.com",
  "www.google-analytics.com",
  "analytics.google.com",
  "schema.org",
  "www.schema.org",
  "www.youtube.com",
  "youtube.com",
  "youtu.be",
  "player.vimeo.com",
  "vimeo.com",
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "www.facebook.com",
  "tiktok.com",
  "www.tiktok.com",
  "twitter.com",
  "x.com",
  "pinterest.com",
  "www.pinterest.com",
]);

export function extractTemplateSectionKeys(indexJson: string | null | undefined): string[] {
  if (!indexJson) return [];

  try {
    const parsed = JSON.parse(indexJson) as {
      order?: string[];
      sections?: Record<string, { type?: string }>;
    };
    const order = Array.isArray(parsed.order) ? parsed.order : [];
    const sections = parsed.sections || {};
    const seen = new Set<string>();
    const keys: string[] = [];

    for (const sectionId of order) {
      const type = sections[sectionId]?.type;
      if (!type) continue;
      const key = `sections/${type}.liquid`;
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }

    return keys;
  } catch {
    return [];
  }
}

export function buildCollectionPillars(collections: CollectionInput[], baseDomain?: string): CollectionPillar[] {
  const normalizedBase = (baseDomain || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const genericPatterns = [
    /\ball products?\b/i,
    /\bfeatured\b/i,
    /\bfrontpage\b/i,
    /\bhome\b/i,
    /\bbest sellers?\b/i,
    /\bnew arrivals?\b/i,
    /\bfabulous finds\b/i,
  ];

  const candidates = collections
    .map((collection) => {
      const title = (collection.title || "").trim();
      const handle = (collection.handle || slugify(title || "pillar")).trim();
      const productsCount = Number(collection.products_count || 0);
      return {
        title: title || handle,
        handle,
        productsCount,
        suggestedSubdomain: normalizedBase ? `${handle}.${normalizedBase}` : "",
      };
    })
    .filter((collection) => collection.title);
  const deduped = Array.from(new Map(candidates.map((collection) => [collection.handle, collection])).values());
  const weighted = deduped.filter((collection) => collection.productsCount > 0);
  const source = weighted.length > 0 ? weighted : deduped;

  return source
    .sort((a, b) => {
      const aGeneric = genericPatterns.some((pattern) => pattern.test(`${a.title} ${a.handle}`));
      const bGeneric = genericPatterns.some((pattern) => pattern.test(`${b.title} ${b.handle}`));
      if (aGeneric !== bGeneric) return aGeneric ? 1 : -1;
      if (a.productsCount !== b.productsCount) return b.productsCount - a.productsCount;
      return a.title.localeCompare(b.title);
    })
    .slice(0, 16);
}

export function analyzeThemeAssets(input: {
  assets: Record<string, string | null>;
  collectionPillars?: CollectionPillar[];
  shopDomain?: string | null;
  shopName?: string | null;
}): ThemeAnalysis {
  const assets = input.assets;
  const themeLiquid = assets["layout/theme.liquid"] || "";
  const footerLiquid = assets["sections/footer.liquid"] || "";
  const baseCss = assets["assets/base.css"] || "";
  const indexSectionKeys = extractTemplateSectionKeys(assets["templates/index.json"]);
  const sectionKeys = Object.keys(assets).filter((key) => key.startsWith("sections/"));
  const orderedSections = [...indexSectionKeys, ...sectionKeys.filter((key) => !indexSectionKeys.includes(key))];

  const imageCandidates = orderedSections.flatMap((key, index) => extractImageCandidates(assets[key] || "", key, index * 100));
  const fallbackCandidates = Object.entries(assets)
    .filter(([key]) => !orderedSections.includes(key))
    .flatMap(([key, value], index) => extractImageCandidates(value || "", key, 1000 + index * 100));
  const allImages = [...imageCandidates, ...fallbackCandidates];
  const lcpCandidate = allImages.length > 0 ? toThemeLcpCandidate(allImages[0], themeLiquid) : null;

  const belowFoldImages = allImages.slice(lcpCandidate ? 1 : 0);
  const belowFoldImagesMissingLazy = belowFoldImages.filter(
    (image) => !image.hasLazyLoading && !image.hasEagerLoading && !image.hasFetchPriorityHigh,
  ).length;
  const unlazyImages = allImages.filter((image, index) => {
    if (index === 0) return false;
    return !image.hasLazyLoading && !image.hasEagerLoading && !image.hasFetchPriorityHigh;
  });

  const hardcodedColors =
    baseCss.match(/#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|hsl\([^)]+\)|hsla\([^)]+\)/g) || [];
  const inlineStyles = (themeLiquid + footerLiquid).match(/style="[^"]{40,}"/gi) || [];
  const forms = (themeLiquid + footerLiquid).match(/<form[^>]*>[\s\S]*?<\/form>/gi) || [];
  const formsWithoutTracking = forms.filter((form) => !/source[_-]?id/i.test(form));
  const policyLinks = detectPolicyLinks(footerLiquid);
  const hasPrivacyLink = policyLinks.find((link) => link.label === "Privacy Policy")?.status === "ok";
  const hasTermsLink = policyLinks.find((link) => link.label === "Terms of Service")?.status === "ok";
  const hasRefundLink = policyLinks.find((link) => link.label === "Refund Policy")?.status === "ok";
  const crossStoreLinks = detectCrossStoreLinks(assets, input.shopDomain || null);
  const detectedBusinessInfo = detectBusinessInfo(footerLiquid, input.shopName || "");
  const supportSiloStatus = evaluateSupportSilo({
    storeLabel: `${input.shopName || ""} ${input.shopDomain || ""}`.trim(),
    supportLocation: detectedBusinessInfo.supportLocation || "",
    supportNumber: detectedBusinessInfo.supportNumber || "",
  });

  const scanIssues: string[] = [];
  if (lcpCandidate) {
    if (!lcpCandidate.hasFetchPriorityHigh || lcpCandidate.loadingMode !== "eager") {
      scanIssues.push(`LCP image in ${lcpCandidate.assetKey} is missing fetchpriority=high or loading=eager`);
    }
    if (!lcpCandidate.preloadDetected) {
      scanIssues.push(`Missing preload tag for the detected LCP asset from ${lcpCandidate.assetKey}`);
    }
  } else {
    scanIssues.push("Could not identify an above-the-fold image candidate for LCP optimization");
  }

  if (belowFoldImagesMissingLazy > 0) {
    scanIssues.push(`${belowFoldImagesMissingLazy} below-the-fold images are missing loading="lazy"`);
  }
  if (hardcodedColors.length > 10) {
    scanIssues.push(`${hardcodedColors.length} hard-coded color values detected; migrate these to CSS variables`);
  }
  if (inlineStyles.length > 0) {
    scanIssues.push(`${inlineStyles.length} large inline style blocks detected`);
  }
  if (formsWithoutTracking.length > 0) {
    scanIssues.push(`${formsWithoutTracking.length} forms are missing source tracking fields`);
  }
  for (const link of policyLinks) {
    if (link.status === "missing") {
      scanIssues.push(`Missing ${link.label} link in footer`);
    } else if (link.status === "dead-link-risk") {
      scanIssues.push(`${link.label} footer link should be normalized to ${link.targetPath}`);
    }
  }
  if (supportSiloStatus.expectedStoreMarker && !supportSiloStatus.matchesLocation) {
    scanIssues.push(`Support location does not match the active ${supportSiloStatus.expectedStoreMarker} store`);
  }
  if (crossStoreLinks.length > 0) {
    scanIssues.push(`${crossStoreLinks.length} hard-coded external domain references detected in theme assets`);
  }
  if ((input.collectionPillars || []).length === 0) {
    scanIssues.push("No weighted collections found for pillar and subdomain suggestions");
  }

  const blogMatches = themeLiquid.match(/blog[^"']*['"][^"']*['"]/gi) || [];

  return {
    scanIssues,
    stats: {
      totalImages: allImages.length,
      unlazyImages: unlazyImages.length,
      hardcodedColors: hardcodedColors.length,
      inlineStyles: inlineStyles.length,
      formsWithoutTracking: formsWithoutTracking.length,
      hasPrivacyLink,
      hasTermsLink,
      hasRefundLink,
      belowFoldImagesMissingLazy,
      crossStoreLinkCount: crossStoreLinks.length,
    },
    blogs: blogMatches,
    sections: orderedSections,
    detectedBusinessInfo,
    lcpCandidate,
    policyLinks,
    collectionPillars: input.collectionPillars || [],
    crossStoreLinks,
    supportSiloStatus,
  };
}

export function buildThemeFixes(input: {
  assets: Record<string, string | null>;
  businessInfo: ThemeBusinessInfo;
  scan: ThemeAnalysis;
  mode?: ThemeFixMode;
}): Record<string, string> {
  const mode = input.mode || "all";
  const includesLcp = mode === "all" || mode === "lcp";
  const includesDomains = mode === "all" || mode === "domains";
  const includesRemaining = mode === "all" || mode === "remaining";
  const rewrittenFiles: Record<string, string> = {};
  const footerOriginal = input.assets["sections/footer.liquid"] || "";
  const themeOriginal = input.assets["layout/theme.liquid"] || "";

  if (includesRemaining && footerOriginal) {
    const footerUpdated = rewriteFooter(footerOriginal, input.businessInfo);
    if (footerUpdated !== footerOriginal) {
      rewrittenFiles["sections/footer.liquid"] = footerUpdated;
    }
  }

  if (includesLcp && input.scan.lcpCandidate) {
    const candidate = input.scan.lcpCandidate;
    const originalAsset = input.assets[candidate.assetKey] || "";
    const updatedAsset = rewriteLcpAsset(originalAsset, candidate);
    if (updatedAsset && updatedAsset !== originalAsset) {
      rewrittenFiles[candidate.assetKey] = updatedAsset;
    }

    const themeBase = rewrittenFiles["layout/theme.liquid"] ?? themeOriginal;
    if (themeBase) {
      const updatedTheme = ensureImagePreload(themeBase, candidate);
      if (updatedTheme !== themeBase) {
        rewrittenFiles["layout/theme.liquid"] = updatedTheme;
      }
    }
  }

  if (includesDomains && input.scan.crossStoreLinks.length > 0) {
    const linksByAsset = input.scan.crossStoreLinks.reduce<Record<string, ThemeLeak[]>>((acc, link) => {
      if (!acc[link.assetKey]) acc[link.assetKey] = [];
      acc[link.assetKey].push(link);
      return acc;
    }, {});

    for (const [assetKey, links] of Object.entries(linksByAsset)) {
      const base = rewrittenFiles[assetKey] ?? input.assets[assetKey];
      if (!base) continue;
      const updated = rewriteExternalDomains(base, links);
      if (updated !== base) {
        rewrittenFiles[assetKey] = updated;
      }
    }
  }

  if (includesRemaining) {
    const lazyTargets = new Set(
      input.scan.sections.filter(
        (key) =>
          key.startsWith("sections/") &&
          key !== input.scan.lcpCandidate?.assetKey,
      ),
    );
    for (const key of lazyTargets) {
      const base = rewrittenFiles[key] ?? input.assets[key];
      if (!base) continue;
      const updated = ensureLazyLoadingForSection(base);
      if (updated !== base) {
        rewrittenFiles[key] = updated;
      }
    }
  }

  if (includesRemaining) {
    const paletteCss = buildPaletteStyles(input.businessInfo);
    if (paletteCss) {
      rewrittenFiles["assets/phoenix-palettes.css"] = paletteCss;
      const themeBase = rewrittenFiles["layout/theme.liquid"] ?? themeOriginal;
      if (themeBase) {
        const updatedTheme = ensurePaletteStylesheet(themeBase);
        if (updatedTheme !== themeBase) {
          rewrittenFiles["layout/theme.liquid"] = updatedTheme;
        }
      }
    }
  }

  return rewrittenFiles;
}

function buildPaletteStyles(businessInfo: ThemeBusinessInfo): string | null {
  const globalColors = (businessInfo.paletteSelection?.colors || []).filter(Boolean);
  const pillarPalettes = businessInfo.pillarPalettes || {};
  const hasPillars = Object.values(pillarPalettes).some((entry) => (entry?.colors || []).length > 0);

  if (globalColors.length === 0 && !hasPillars) return null;

  const lines: string[] = ["/* Phoenix Flow Palette */"];

  if (globalColors.length > 0) {
    lines.push(
      `:root{--phoenix-primary:${globalColors[0]};--phoenix-accent:${globalColors[1] || globalColors[0]};--phoenix-highlight:${globalColors[2] || globalColors[1] || globalColors[0]};--phoenix-ink:${globalColors[3] || "#111827"};}`,
    );
  }

  for (const [handle, entry] of Object.entries(pillarPalettes)) {
    const colors = (entry?.colors || []).filter(Boolean);
    if (colors.length === 0) continue;
    lines.push(
      `[data-phoenix-pillar="${handle}"]{--phoenix-primary:${colors[0]};--phoenix-accent:${colors[1] || colors[0]};--phoenix-highlight:${colors[2] || colors[1] || colors[0]};--phoenix-ink:${colors[3] || "#111827"};}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function ensurePaletteStylesheet(themeLiquid: string): string {
  const tag = "phoenix-palettes.css";
  if (themeLiquid.includes(tag)) return themeLiquid;
  const linkTag = `<link rel="stylesheet" href="{{ '${tag}' | asset_url }}" media="all">`;
  if (themeLiquid.includes("</head>")) {
    return themeLiquid.replace("</head>", `${linkTag}\n</head>`);
  }
  return themeLiquid;
}

function extractImageCandidates(content: string, assetKey: string, baseRank: number): ImageCandidate[] {
  if (!content) return [];

  const candidates: ImageCandidate[] = [];
  const rawImgTags = content.match(/<img\b[^>]*>/gi) || [];
  rawImgTags.forEach((tag, index) => {
    const source = extractAttribute(tag, "src");
    if (!source) return;
    candidates.push({
      assetKey,
      tag,
      source,
      sourceFingerprint: normalizeWhitespace(source),
      hasLazyLoading: /\bloading\s*=\s*['"]lazy['"]/i.test(tag),
      hasEagerLoading: /\bloading\s*=\s*['"]eager['"]/i.test(tag),
      hasFetchPriorityHigh: /\bfetchpriority\s*=\s*['"]high['"]/i.test(tag),
      rank: baseRank + index,
    });
  });

  const liquidImageTags = content.match(/{{[\s\S]*?\|\s*image_tag(?::[\s\S]*?)?}}/g) || [];
  liquidImageTags.forEach((tag, index) => {
    const expressionMatch = tag.match(/{{\s*([\s\S]*?)\|\s*image_tag(?::[\s\S]*?)?}}/);
    const sourceExpression = expressionMatch?.[1]?.trim();
    if (!sourceExpression) return;
    candidates.push({
      assetKey,
      tag,
      source: `{{ ${sourceExpression} }}`,
      sourceFingerprint: normalizeWhitespace(sourceExpression),
      sourceExpression,
      hasLazyLoading: /loading\s*:\s*['"]lazy['"]/i.test(tag),
      hasEagerLoading: /loading\s*:\s*['"]eager['"]/i.test(tag),
      hasFetchPriorityHigh: /fetchpriority\s*:\s*['"]high['"]/i.test(tag),
      rank: baseRank + rawImgTags.length + index,
    });
  });

  return candidates.sort((a, b) => a.rank - b.rank);
}

function toThemeLcpCandidate(candidate: ImageCandidate, themeLiquid: string): ThemeLcpCandidate {
  return {
    assetKey: candidate.assetKey,
    tag: candidate.tag,
    source: candidate.source,
    sourceFingerprint: candidate.sourceFingerprint,
    sourceExpression: candidate.sourceExpression,
    loadingMode: candidate.hasEagerLoading ? "eager" : candidate.hasLazyLoading ? "lazy" : "missing",
    hasFetchPriorityHigh: candidate.hasFetchPriorityHigh,
    preloadDetected: detectPreload(themeLiquid, candidate),
  };
}

function detectPreload(themeLiquid: string, candidate: ImageCandidate): boolean {
  if (!themeLiquid) return false;

  if (candidate.sourceExpression) {
    return themeLiquid.includes(candidate.sourceExpression) && /rel=["']preload["']/i.test(themeLiquid);
  }

  return themeLiquid.includes(candidate.source) && /rel=["']preload["']/i.test(themeLiquid);
}

function detectPolicyLinks(footerLiquid: string): ThemePolicyLink[] {
  const links = footerLiquid.match(/<a\b[^>]*href=["'][^"']*["'][^>]*>[\s\S]*?<\/a>/gi) || [];

  return POLICY_TARGETS.map((policy) => {
    const matchingAnchor = links.find((link) => policy.matchers.some((matcher) => matcher.test(stripHtml(link))));
    if (!matchingAnchor) {
      return {
        label: policy.label,
        targetPath: policy.targetPath,
        href: null,
        status: "missing" as const,
      };
    }

    const href = extractAttribute(matchingAnchor, "href");
    if (!href) {
      return {
        label: policy.label,
        targetPath: policy.targetPath,
        href: null,
        status: "dead-link-risk" as const,
      };
    }

    return {
      label: policy.label,
      targetPath: policy.targetPath,
      href,
      status: href.includes(policy.targetPath) ? "ok" : "dead-link-risk",
    };
  });
}

function detectCrossStoreLinks(assets: Record<string, string | null>, shopDomain: string | null): ThemeLeak[] {
  const leaks: ThemeLeak[] = [];
  const currentDomain = normalizeDomain(shopDomain || "");

  for (const [assetKey, content] of Object.entries(assets)) {
    if (!content) continue;
    const urls = content.match(/https?:\/\/[^\s"'<>]+/gi) || [];

    for (const url of urls) {
      try {
        const domain = normalizeDomain(new URL(url).hostname);
        if (!domain) continue;
        if (currentDomain && domain === currentDomain) continue;
        if (currentDomain && domain === normalizeDomain(currentDomain.replace(".myshopify.com", ""))) continue;
        if (SAFE_EXTERNAL_DOMAINS.has(domain)) continue;
        if (domain.endsWith(".myshopify.com")) continue;
        leaks.push({ assetKey, domain, url });
      } catch {
        continue;
      }
    }
  }

  return dedupeLeaks(leaks);
}

function detectBusinessInfo(footerLiquid: string, fallbackName: string): ThemeBusinessInfo {
  const footerText = stripHtml(footerLiquid);
  const legalEntityMatch =
    footerText.match(/(?:\u00A9|copyright)\s*(?:\d{4}\s*)?(.*?(?:LLC|INC|CORP(?:ORATION)?|LTD|CO\.?))/i) ||
    footerText.match(/(.*?(?:LLC|INC|CORP(?:ORATION)?|LTD|CO\.?))/i);
  const stateMatch =
    footerText.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/) ||
    footerText.match(/\b(?:California|New York|Texas|Florida|Wyoming|Washington|Oregon|Colorado)\b/i);
  const phoneMatch = footerText.match(/(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  const supportLocationMatch = footerText.match(/(?:support|serving|located in|from)\s+([A-Za-z\s]+,\s*[A-Za-z]{2})/i);
  const addressLocationMatch = footerText.match(/address:\s*(?:.*?)([A-Za-z][A-Za-z\s.-]+,\s*[A-Za-z]{2})/i);
  const operationsLocationMatch = footerText.match(/operations:\s*([A-Za-z\s]+county,\s*[A-Za-z]{2})/i);

  return {
    legalEntityName: legalEntityMatch?.[1]?.trim() || "",
    stateOfIncorporation: stateMatch?.[0]?.trim() || "",
    supportLocation: operationsLocationMatch?.[1]?.trim()
      || addressLocationMatch?.[1]?.trim()
      || supportLocationMatch?.[1]?.trim()
      || "",
    supportNumber: phoneMatch?.[1]?.trim() || "",
  };
}

function evaluateSupportSilo(input: {
  storeLabel: string;
  supportLocation: string;
  supportNumber: string;
}): ThemeAnalysis["supportSiloStatus"] {
  const normalizedStore = input.storeLabel.toLowerCase();
  const expectedStoreMarker = normalizedStore.includes("saratoga")
    ? "Saratoga"
    : normalizedStore.includes("clifton")
      ? "Clifton Park"
      : null;

  if (!expectedStoreMarker) {
    return {
      expectedStoreMarker: null,
      matchesLocation: true,
      matchesPhoneContext: true,
    };
  }

  const marker = expectedStoreMarker.toLowerCase();
  const normalizedSupport = input.supportLocation.toLowerCase();
  const saratogaAliases = ["saratoga", "saratoga county", "ballston spa"];
  const matchesSaratoga = expectedStoreMarker === "Saratoga"
    ? saratogaAliases.some((alias) => normalizedSupport.includes(alias))
    : false;

  return {
    expectedStoreMarker,
    matchesLocation: matchesSaratoga || normalizedSupport.includes(marker),
    matchesPhoneContext: input.supportNumber.trim().length > 0,
  };
}

function rewriteFooter(footerLiquid: string, businessInfo: ThemeBusinessInfo): string {
  let updated = footerLiquid;

  for (const policy of POLICY_TARGETS) {
    updated = normalizePolicyLink(updated, policy.label, policy.targetPath, policy.matchers);
  }

  const legalName = businessInfo.legalEntityName?.trim() || "";
  const stateRaw = businessInfo.stateOfIncorporation?.trim() || "";
  const supportLocation = businessInfo.supportLocation?.trim() || "";
  const supportNumber = businessInfo.supportNumber?.trim() || "";

  if (!legalName || !stateRaw || !supportLocation || !supportNumber) {
    return updated;
  }

  const state = normalizeState(stateRaw);

  const block = [
    "{% comment %} Phoenix Flow automated compliance anchors {% endcomment %}",
    "<div class=\"phoenix-flow-identity-block\">",
    `  <p>&copy; {{ 'now' | date: '%Y' }} ${escapeHtml(legalName)} | Incorporated in ${escapeHtml(state)}.</p>`,
    `  <p>Support: ${escapeHtml(supportLocation)} | ${escapeHtml(supportNumber)}</p>`,
    "  <p>",
    "    <a href=\"/policies/privacy-policy\">Privacy Policy</a>",
    "    <span aria-hidden=\"true\"> | </span>",
    "    <a href=\"/policies/terms-of-service\">Terms of Service</a>",
    "    <span aria-hidden=\"true\"> | </span>",
    "    <a href=\"/policies/refund-policy\">Refund Policy</a>",
    "  </p>",
    "</div>",
  ].join("\n");

  const markerRegex = /{% comment %} Phoenix Flow automated compliance anchors {% endcomment %}[\s\S]*?<div class="phoenix-flow-identity-block">[\s\S]*?<\/div>/i;
  if (markerRegex.test(updated)) {
    updated = updated.replace(markerRegex, block);
  } else if (/<\/footer>/i.test(updated)) {
    updated = updated.replace(/<\/footer>/i, `${block}\n</footer>`);
  } else if (/{% schema %}/i.test(updated)) {
    updated = updated.replace(/{% schema %}/i, `${block}\n\n{% schema %}`);
  } else {
    updated = `${updated}\n\n${block}\n`;
  }

  return updated;
}

function rewriteLcpAsset(assetContent: string, candidate: ThemeLcpCandidate): string {
  if (!assetContent) return assetContent;

  let updated = assetContent;
  if (candidate.tag.startsWith("<img")) {
    const replacement = ensureHtmlImgAttributeSet(candidate.tag, "loading", "eager");
    const withPriority = ensureHtmlImgAttributeSet(replacement, "fetchpriority", "high");
    updated = updated.replace(candidate.tag, withPriority);
  } else {
    const replacement = ensureLiquidImageTagArgument(candidate.tag, "loading", "eager");
    const withPriority = ensureLiquidImageTagArgument(replacement, "fetchpriority", "high");
    updated = updated.replace(candidate.tag, withPriority);
  }

  return updated;
}

function ensureImagePreload(themeLiquid: string, candidate: ThemeLcpCandidate): string {
  if (!themeLiquid || candidate.preloadDetected) return themeLiquid;

  const href = candidate.sourceExpression
    ? `{{ ${candidate.sourceExpression} }}`
    : candidate.source;
  const preloadTag = `  <link rel="preload" as="image" href="${href}">`;

  if (/<\/head>/i.test(themeLiquid)) {
    return themeLiquid.replace(/<\/head>/i, `${preloadTag}\n</head>`);
  }

  return `${themeLiquid}\n${preloadTag}\n`;
}

function ensureLazyLoadingForSection(sectionContent: string): string {
  let updated = sectionContent;

  updated = updated.replace(/<img\b[^>]*>/gi, (tag) => {
    if (/\bloading\s*=/i.test(tag) || /\bfetchpriority\s*=\s*['"]high['"]/i.test(tag)) {
      return tag;
    }
    return ensureHtmlImgAttributeSet(tag, "loading", "lazy");
  });

  updated = updated.replace(/{{[\s\S]*?\|\s*image_tag(?::[\s\S]*?)?}}/g, (tag) => {
    if (/loading\s*:/i.test(tag) || /fetchpriority\s*:\s*['"]high['"]/i.test(tag)) {
      return tag;
    }
    return ensureLiquidImageTagArgument(tag, "loading", "lazy");
  });

  return updated;
}

function rewriteExternalDomains(content: string, links: ThemeLeak[]): string {
  let updated = content;

  for (const link of links) {
    const replacement = toRelativeStoreUrl(link.url);
    if (!replacement || replacement === link.url) continue;
    updated = updated.split(link.url).join(replacement);
  }

  return updated;
}

function toRelativeStoreUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const relative = `${parsed.pathname || "/"}${parsed.search}${parsed.hash}`;
    return relative || "/";
  } catch {
    return url;
  }
}

function ensureHtmlImgAttributeSet(tag: string, attribute: string, value: string): string {
  const regex = new RegExp(`\\b${attribute}\\s*=\\s*['"][^'"]*['"]`, "i");
  if (regex.test(tag)) {
    return tag.replace(regex, `${attribute}="${value}"`);
  }

  return tag.replace(/\/?>$/, ` ${attribute}="${value}"$&`);
}

function ensureLiquidImageTagArgument(tag: string, name: string, value: string): string {
  const existingArg = new RegExp(`${name}\\s*:\\s*['"][^'"]*['"]`, "i");
  if (existingArg.test(tag)) {
    return tag.replace(existingArg, `${name}: '${value}'`);
  }

  return tag.replace(/}}$/, `, ${name}: '${value}' }}`);
}

function normalizePolicyLink(
  footerLiquid: string,
  label: string,
  targetPath: string,
  matchers: readonly RegExp[],
): string {
  return footerLiquid.replace(/<a\b[^>]*href=["'][^"']*["'][^>]*>[\s\S]*?<\/a>/gi, (anchor) => {
    if (!matchers.some((matcher) => matcher.test(stripHtml(anchor)))) return anchor;
    return anchor.replace(/href=["'][^"']*["']/i, `href="${targetPath}"`);
  });
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAttribute(tag: string, attribute: string): string | null {
  const match = tag.match(new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] || null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "pillar";
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeState(state: string | undefined): string {
  const value = (state || "").trim();
  if (!value) return "Wyoming";
  if (value.toUpperCase() === "WY") return "Wyoming";
  return value;
}

function normalizeDomain(value: string): string {
  return value.toLowerCase().replace(/^www\./, "").trim();
}

function dedupeLeaks(leaks: ThemeLeak[]): ThemeLeak[] {
  const seen = new Set<string>();
  return leaks.filter((leak) => {
    const key = `${leak.assetKey}:${leak.domain}:${leak.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
