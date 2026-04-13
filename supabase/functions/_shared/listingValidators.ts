const ASCII_REPLACEMENTS: Array<[RegExp, string]> = [
  [(new RegExp(`[${String.fromCharCode(24)}${String.fromCharCode(25)}]`, "g")), ""],
  [(new RegExp(`[${String.fromCharCode(11)}${String.fromCharCode(12)}]`, "g")), " "],
  [/\r\n?/g, "\n"],
  [/[\u201C\u201D]/g, '"'],
  [/[\u2018\u2019]/g, "'"],
  [/[\u2013\u2014]/g, "-"],
  [/\u2022/g, "-"],
  [/[\u2122\u00AE\u00A9]/g, ""],
  [/\u2026/g, "..."],
  [(new RegExp(String.fromCharCode(0), "g")), ""],
];

const PROMO_PATTERNS = [
  /\bfree shipping\b/gi,
  /\bbest seller\b/gi,
  /\bbestseller\b/gi,
  /\bon sale\b/gi,
  /\bsale\b/gi,
  /\blimited time\b/gi,
  /\bmust have\b/gi,
];

const APPAREL_KEYWORDS = [
  "shirt", "tee", "t-shirt", "hoodie", "sweatshirt", "sweater", "jacket", "dress", "pants", "leggings",
  "shorts", "top", "tank", "skirt", "apparel", "clothing", "beanie", "hat", "cap", "socks", "sock",
  "onesie", "romper", "jersey", "uniform", "pullover",
  "lounge", "loungewear", "jogger", "pajama", "pyjama", "jumpsuit", "bodysuit", "set", "tracksuit",
];

const COLOR_WORDS = [
  "black", "white", "red", "blue", "green", "yellow", "orange", "purple", "pink", "brown", "tan", "beige",
  "gold", "silver", "gray", "grey", "navy", "teal", "maroon", "burgundy", "olive", "cream", "ivory", "khaki",
  "charcoal", "lavender", "mint", "coral", "turquoise", "bronze", "rose gold",
];

const SIZE_ORDER = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "2xl", "xxxl", "3xl", "4xl", "5xl", "6xl"];
const BANNED_TAGS = [
  // Dropshipping platforms
  "cjdropshipping", "cj dropshipping", "cj-drop shipping", "cj dropship", "cjdropship", "dropshipping", "drop shipping",
  // Competitor brand names (never tag with rival brands)
  "boo hoo", "boohoo", "shein", "temu", "aliexpress", "asos", "h&m", "zara", "forever 21", "forever21",
  // Marketplace references
  "ebay", "amazon", "etsy", "walmart", "target", "womens ebay store", "ebay store",
  // Single-word articles / prepositions that sneak in as tag fragments
  "the", "and", "for", "with", "from", "this", "that", "its",
  // Promo / spam
  "sale dresses", "cheap chic", "new dress", "on demand production", "on-demand production",
  // Nonsense/negative
  "frumpy business dress", "mental calm dress", "magic dress", "gaming stream style",
];

export interface EtsyListingLike {
  title?: string;
  description?: string;
  tags?: string[];
  materials?: string[];
  taxonomy_path?: string;
}

export interface EtsySuggestionShape {
  title?: string;
  description?: string;
  tags?: string[];
  materials?: string[];
  reasoning?: string;
}

export interface ShopifyVariantLike {
  title?: string;
  option1?: string;
  option2?: string;
  option3?: string;
  price?: string;
  inventory_quantity?: number;
}

export interface ShopifyProductLike {
  title?: string;
  body_html?: string;
  product_type?: string;
  vendor?: string;
  tags?: string;
  handle?: string;
  variants?: ShopifyVariantLike[];
  images?: { id: number; src?: string; alt?: string | null; position?: number }[];
  metafields_global_title_tag?: string;
  metafields_global_description_tag?: string;
}

export interface ShopifySuggestionShape {
  title?: string;
  body_html?: string;
  seo_title?: string;
  seo_description?: string;
  product_type?: string;
  tags?: string;
  variant_suggestions?: string;
  url_handle?: string;
  faq_json?: string;
  collections_suggestion?: string;
  image_alts?: string;
  image_filenames?: string;
  reasoning?: string;
}

function replaceAscii(value: string): string {
  let next = value.normalize("NFKD");
  for (const [pattern, replacement] of ASCII_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }

  return Array.from(next)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
    })
    .join("");
}

function collapseWhitespace(value: string): string {
  return value.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

function finalHardClean(value: string): string {
  return value
    .replace(/["“”‘’'']/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\|\s*\|/g, "|")
    .trim();
}

function sanitizePlainText(value: string, maxLength?: number): string {
  let next = collapseWhitespace(replaceAscii(value || ""));
  for (const pattern of PROMO_PATTERNS) {
    next = next.replace(pattern, "");
  }
  next = next.replace(/\b([A-Z]{3,})\b/g, (match) => (match === match.toUpperCase() ? match.toLowerCase() : match));
  next = next.replace(/([!?.,])\1+/g, "$1");
  next = next.replace(/\s{2,}/g, " ").trim();
  if (!maxLength || next.length <= maxLength) return next;
  const sliced = next.slice(0, maxLength);
  const boundary = sliced.lastIndexOf(" ");
  return (boundary > Math.floor(maxLength * 0.6) ? sliced.slice(0, boundary) : sliced).trim();
}

// Trim SEO description to maxLength, preferring a sentence boundary over a word boundary.
// Google shows ~155-160 chars — we target 158 so it fills the preview without getting cut.
function trimSeoDescription(value: string, maxLength = 158): string {
  if (value.length <= maxLength) return value;
  const sliced = value.slice(0, maxLength);
  // Prefer ending at a sentence boundary (., !, ?) in the last 30% of the string
  const sentenceEnd = sliced.search(/[.!?][^.!?]*$/);
  if (sentenceEnd > Math.floor(maxLength * 0.7)) {
    return sliced.slice(0, sentenceEnd + 1).trim();
  }
  // Fall back to word boundary
  const wordBoundary = sliced.lastIndexOf(" ");
  return (wordBoundary > Math.floor(maxLength * 0.6) ? sliced.slice(0, wordBoundary) : sliced).trim();
}

function trimBrokenTail(value: string): string {
  return value.replace(/\b[A-Z][a-z]*\s*$/, "").trim();
}

const SUPPLIER_HOST_RE = /\b(?:cjdropshipping\.com|alicdn\.com|aliexpress\.com|ae\d+\.alicdn|dhgate\.com|ebayimg\.com)\b/i;

// Phrases that indicate the AI returned supplier template copy without rewriting
const SUPPLIER_BODY_PHRASES = [
  /\bYour Design\b/gi,
  /\bExquisite canvas wall art\b/gi,
  /\bbring you a new sense of atmosphere\b/gi,
  /\bEYE-CATCHING DECOR\b/gi,
  /Use Glue or Hook install/gi,
  /upload your (own )?images?\b/gi,
  /enter the text\s*\/logos/gi,
  /customize with any picture/gi,
];

function sanitizeHtml(value: string): string {
  let html = value || "";
  // Strip supplier-hosted images
  html = html.replace(/<img[^>]+>/gi, (tag) => SUPPLIER_HOST_RE.test(tag) ? "" : tag);
  // Convert <b>/<i> to semantic equivalents (AI should use <strong> per our rules)
  html = html.replace(/<b(\s[^>]*)?>/gi, "<strong>").replace(/<\/b>/gi, "</strong>");
  html = html.replace(/<i(\s[^>]*)?>/gi, "<em>").replace(/<\/i>/gi, "</em>");
  // Strip empty divs and lone <br> blocks left by suppliers
  html = html.replace(/<div>\s*<br\s*\/?>\s*<\/div>/gi, "");
  html = html.replace(/(<br\s*\/?>\s*){2,}/gi, "<br>");
  // Strip supplier catch-phrases that signal unrewritten content
  for (const phrase of SUPPLIER_BODY_PHRASES) {
    html = html.replace(phrase, "");
  }
  return collapseWhitespace(replaceAscii(html));
}

function normalizeKeywordPhrase(value: string): string {
  return sanitizePlainText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .trim();
}

function singularizeToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) return token.slice(0, -1);
  return token;
}

function keywordSignature(value: string): string {
  return normalizeKeywordPhrase(value)
    .split(/\s+/)
    .filter(Boolean)
    .map(singularizeToken)
    .sort()
    .join(" ");
}

function trimPhraseToLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const words = value.split(/\s+/).filter(Boolean);
  let next = "";
  for (const word of words) {
    const candidate = next ? `${next} ${word}` : word;
    if (candidate.length > maxLength) break;
    next = candidate;
  }
  return (next || value.slice(0, maxLength)).trim();
}

function trimToWordCount(value: string, maxWords: number): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value;
  return words.slice(0, maxWords).join(" ").trim();
}

function firstSentence(value: string): string {
  const match = value.match(/^(.*?)([.!?]\s|$)/);
  return (match ? match[1] : value).trim();
}

function extractTitleKeywords(title: string): string[] {
  return sanitizePlainText(title)
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 6);
}

function ensureEtsyDescriptionLead(title: string, description: string): { description: string; addedLead: boolean } {
  const keywords = extractTitleKeywords(title);
  if (keywords.length === 0) {
    return { description, addedLead: false };
  }

  const lead = firstSentence(description).toLowerCase();
  const hasKeyword = keywords.some((keyword) => lead.includes(keyword));
  if (hasKeyword) return { description, addedLead: false };

  const prefixed = `${title}. ${description}`.trim();
  return { description: prefixed, addedLead: true };
}

function dedupeBySignature(values: string[], maxLength: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = trimPhraseToLength(sanitizePlainText(value).toLowerCase(), maxLength);
    if (!normalized) continue;
    const signature = keywordSignature(normalized);
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    output.push(normalized);
  }
  return output;
}

function sanitizeHandle(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function isBannedTag(value: string, vendor?: string): boolean {
  const normalized = normalizeKeywordPhrase(value);
  if (!normalized) return true;
  if (BANNED_TAGS.some((tag) => normalizeKeywordPhrase(tag) === normalized)) return true;
  if (vendor) {
    const normalizedVendor = normalizeKeywordPhrase(vendor);
    if (normalizedVendor && normalized === normalizedVendor) return true;
  }
  return false;
}

function buildEtsyFallbackTags(listing: EtsyListingLike): string[] {
  const sourceItems = [
    ...(listing.tags || []),
    ...(listing.materials || []),
    ...(listing.taxonomy_path ? listing.taxonomy_path.split(/[>/|,]/) : []),
    ...sanitizePlainText(listing.title || "").split(/[-,]/),
  ].map((item) => String(item));

  const titleWords = sanitizePlainText(listing.title || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2);

  const phrases: string[] = [];
  for (let size = 3; size >= 2; size -= 1) {
    for (let index = 0; index <= titleWords.length - size; index += 1) {
      phrases.push(titleWords.slice(index, index + size).join(" "));
    }
  }

  return dedupeBySignature([...sourceItems, ...phrases, ...titleWords], 20);
}

function buildDefaultEtsyDescription(listing: EtsyListingLike): string {
  const materials = (listing.materials || []).join(", ");
  const title = sanitizePlainText(listing.title || "This item");
  const lead = materials
    ? `${title} is made with ${materials} and is written to help buyers quickly understand the main details before they purchase.`
    : `${title} is written to help buyers quickly understand the main details before they purchase.`;
  return sanitizePlainText(
    `${lead} Review the sizing, materials, finish, and ordering details at the top, then use the rest of the description to explain what makes the item feel useful, giftable, or distinctive.`,
    900,
  );
}

function buildShopifyFallbackTags(product: ShopifyProductLike): string[] {
  const sourceItems: string[] = [
    ...(product.tags ? String(product.tags).split(",") : []),
    product.product_type || "",
    product.vendor || "",
    product.title || "",
  ]
    .map((item) => String(item))
    .filter(Boolean);

  const titleWords = sanitizePlainText(product.title || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2);

  const phrases: string[] = [];
  for (let size = 3; size >= 2; size -= 1) {
    for (let index = 0; index <= titleWords.length - size; index += 1) {
      phrases.push(titleWords.slice(index, index + size).join(" "));
    }
  }

  return dedupeBySignature(
    [...sourceItems, ...phrases, ...titleWords],
    40,
  );
}

function extractColor(text: string): string {
  const normalized = normalizeKeywordPhrase(text);
  return COLOR_WORDS.find((color) => normalized.includes(color)) || "";
}

function extractSizeRange(product: ShopifyProductLike): string {
  const variants = product.variants || [];
  const variantValues = variants.flatMap((variant) =>
    [variant.title, variant.option1, variant.option2, variant.option3].filter(Boolean) as string[],
  );
  const normalized = variantValues.join(" ").toLowerCase();

  const explicitRange = normalized.match(/\b((?:xxs|xs|s|m|l|xl|xxl|xxxl|4xl|5xl|\d+))\s*-\s*((?:xxs|xs|s|m|l|xl|xxl|xxxl|4xl|5xl|\d+))\b/);
  if (explicitRange) return `${explicitRange[1].toUpperCase()}-${explicitRange[2].toUpperCase()}`;

  const seenSizes = new Set<string>();
  for (const size of SIZE_ORDER) {
    const pattern = new RegExp(`(^|[^a-z0-9])${size}([^a-z0-9]|$)`, "i");
    if (pattern.test(normalized)) seenSizes.add(size);
  }
  if (seenSizes.size > 1) {
    const ordered = SIZE_ORDER.filter((size) => seenSizes.has(size));
    return `${ordered[0].toUpperCase()}-${ordered[ordered.length - 1].toUpperCase()}`;
  }
  if (seenSizes.size === 1) {
    return Array.from(seenSizes)[0].toUpperCase();
  }

  const numeric = Array.from(
    new Set((normalized.match(/\b\d{1,3}\b/g) || []).map((value) => Number(value)).filter(Number.isFinite)),
  ).sort((left, right) => left - right);
  if (numeric.length > 1) return `${numeric[0]}-${numeric[numeric.length - 1]}`;
  if (numeric.length === 1) return String(numeric[0]);
  return "";
}

function isApparelProduct(product: ShopifyProductLike): boolean {
  const haystack = `${product.title || ""} ${product.product_type || ""} ${product.tags || ""}`.toLowerCase();
  return APPAREL_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function buildRequiredApparelSuffix(product: ShopifyProductLike): string {
  const source = `${product.title || ""} ${product.tags || ""}`;
  const color = extractColor(source);
  const sizeRange = extractSizeRange(product);
  return [color ? color.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "", sizeRange].filter(Boolean).join(" ").trim();
}

function appendValidationNotes(reasoning: string | undefined, notes: string[]): string {
  const base = sanitizePlainText(reasoning || "Platform rules enforced.", 320);
  if (notes.length === 0) return base;
  return sanitizePlainText(`${base} Validator: ${notes.join("; ")}.`, 500);
}

export function normalizeEtsySuggestions(listing: EtsyListingLike, raw: EtsySuggestionShape): EtsySuggestionShape {
  const notes: string[] = [];
  const sourceTitle = sanitizePlainText(listing.title || "", 140);
  const rawTitle = sanitizePlainText(raw.title || sourceTitle, 140) || sourceTitle;
  const trimmedTitle = trimToWordCount(rawTitle, 15);
  const title = sanitizePlainText(trimmedTitle, 140) || sourceTitle;
  if (rawTitle !== title) notes.push("title trimmed to under 15 words and Etsy-safe length");

  const baseDescription = sanitizePlainText(raw.description || listing.description || buildDefaultEtsyDescription(listing), 900);
  const leadCheck = ensureEtsyDescriptionLead(title, baseDescription);
  const description = sanitizePlainText(leadCheck.description, 900);
  if (!raw.description) notes.push("description filled from existing listing context");
  if (leadCheck.addedLead) notes.push("first sentence now clearly states the item");

  let tags = dedupeBySignature([...(Array.isArray(raw.tags) ? raw.tags : []), ...buildEtsyFallbackTags(listing)], 20).slice(0, 13);
  if (tags.length < 13) {
    tags = dedupeBySignature([...tags, ...buildEtsyFallbackTags({ ...listing, tags })], 20).slice(0, 13);
  }
  if (tags.length !== 13) notes.push(`tag set normalized to ${tags.length} unique Etsy-safe phrases`);

  const materials = dedupeBySignature([...(raw.materials || []), ...(listing.materials || [])], 30).slice(0, 8);
  if (!raw.materials?.length && materials.length > 0) notes.push("materials restored from source listing");

  return {
    title,
    description,
    tags,
    materials,
    reasoning: appendValidationNotes(raw.reasoning, notes),
  };
}

export function normalizeShopifySuggestions(product: ShopifyProductLike, raw: ShopifySuggestionShape): ShopifySuggestionShape {
  const notes: string[] = [];
  const apparel = isApparelProduct(product);
  const requiredSuffix = apparel ? buildRequiredApparelSuffix(product) : "";

  /**
   * BRAND STRIPPER v2.5 - PUBLIC RELEASE
   * Removes common title-junk patterns to ensure a clean, brand-agnostic product name.
   */
  function stripInternalBranding(v: string): string {
    if (!v) return "";

    // 1. Remove pipe-appended suffixes only (e.g., "Mushroom Coffee | Brand Name" -> "Mushroom Coffee")
    // Dashes are preserved — they appear in product names like "3-Piece Set"
    v = v.replace(/\s*\|\s*[^|]+$/gi, "");

    // 2. Remove "The Machine" and Niche Identifiers (Scrubbing for total white-labeling)
    const legacyFragments = /\b(iron phoenix ghg|iron phoenix|our phoenix rise|go hard gaming|ghg|phoenix flow)\b/gi;
    v = v.replace(legacyFragments, "");

    // 3. Remove Promotional "Noise" (GMC Compliance requirement)
    const promoNoise = /\b(free shipping|sale|best seller|official|genuine|authentic|100%|new)\b/gi;
    v = v.replace(promoNoise, "");

    // 4. Final Structural Clean
    v = v
      .replace(/\s{2,}/g, " ")      // Collapse double spaces
      .replace(/[^\w\s\d]$/g, "")   // Remove trailing special chars
      .trim();

    return v || "Product Title";
  }

  // --- TITLE & SEO NORMALIZATION ---
  
  // Use the public scrubber for both Title and SEO Title
  let title = sanitizePlainText(stripInternalBranding(raw.title || product.title || ""), 70).replace(/"/g, "");
  
  const seo_title = sanitizePlainText(
    stripInternalBranding(raw.seo_title || title || product.metafields_global_title_tag || product.title || ""), 
    60
  ).replace(/"/g, "");

  const BRAND_NAME_PATTERN = /\b(iron phoenix ghg|iron phoenix|our phoenix rise|go hard gaming|ghg|phoenix flow)\b/gi;
  const seo_description = trimSeoDescription(
    sanitizePlainText(
      (raw.seo_description || product.metafields_global_description_tag || "")
        .replace(BRAND_NAME_PATTERN, "")
        .replace(/\s{2,}/g, " ")
        .trim()
    ).replace(/"/g, ""),
    158
  );

  // Prefer AI-generated body. Only fall back to product.body_html if AI returned nothing,
  // and even then sanitizeHtml will strip any supplier-hosted images.
  const body_html = sanitizeHtml(raw.body_html || product.body_html || "");
  const product_type = sanitizePlainText(raw.product_type || product.product_type || "", 255);

  // Apparel Logic: Re-inject color/size if they were accidentally scrubbed
  if (apparel && requiredSuffix) {
    const normalizedTitle = normalizeKeywordPhrase(title);
    const normalizedSuffix = normalizeKeywordPhrase(requiredSuffix);
    if (!normalizedTitle.includes(normalizedSuffix)) {
      const core = stripInternalBranding(title.replace(new RegExp(requiredSuffix, "ig"), "").trim());
      title = sanitizePlainText(`${core} ${requiredSuffix}`.trim(), 70);
      notes.push("apparel title normalized to include required color/size details");
    }
  }

  // --- TAG & COMPLIANCE NORMALIZATION ---

  // Helper: Ensures tags don't contain retail branding or banned terms
  const brandFragments = ["iron phoenix ghg", "iron phoenix", "ghg", "our phoenix rise"].map(normalizeKeywordPhrase);
  const tagQualifies = (t: string) => {
    if (!t.trim()) return false;
    const normalized = normalizeKeywordPhrase(t);
    // Filter out your retail brands from the public tool's output
    if (brandFragments.some((frag) => normalized.includes(frag))) return false;
    if (product.vendor && normalized.includes(normalizeKeywordPhrase(product.vendor))) return false;
    return !isBannedTag(t, product.vendor);
  };



  // Merge AI-generated tags WITH existing product tags — AI is instructed to generate
  // only NEW tags, but we combine both so nothing is lost. Filter out single-char
  // fragments (hyphen-split artifacts like "the", "off") before dedup.
  const aiTagList = String(raw.tags || "").split(",").map((t) => t.trim()).filter((t) => t.length > 2);
  const existingTagList = String(product.tags || "").split(",").map((t) => t.trim()).filter((t) => t.length > 2);
  let tags = dedupeBySignature(
    [...aiTagList, ...existingTagList],
    255
  ).filter((tag) => !isBannedTag(tag, product.vendor));

  if (apparel && requiredSuffix) {
    const color = extractColor(requiredSuffix);
    if (color && !tags.some((tag) => normalizeKeywordPhrase(tag) === normalizeKeywordPhrase(color))) {
      tags = dedupeBySignature([...tags, color], 255);
      notes.push("color tag restored for apparel");
    }
  }

  // Pad with fallback tags if AI didn't produce enough qualifying ones
  if (tags.filter(tagQualifies).length < 20) {
    const fallbackTags = buildShopifyFallbackTags(product).filter(tagQualifies);
    tags = dedupeBySignature([...tags, ...fallbackTags], 255).slice(0, 250);
    notes.push("tags padded from product title and type");
  }

  // Guarantee minimum 20 tags — Shopify long-tail tags drive organic discovery
  if (tags.length < 20) {
    const fallbackTags = buildShopifyFallbackTags(product).filter(tagQualifies);
    tags = dedupeBySignature([...tags, ...fallbackTags], 255).slice(0, 20);
    notes.push("guaranteed at least 20 tags");
  }


  // seo_title falls back to product title if empty; seo_description stays empty rather than invent content
  let cleanSeoTitle = finalHardClean(seo_title);
  const cleanSeoDescription = finalHardClean(seo_description);
  if (!cleanSeoTitle) cleanSeoTitle = title;

  // Final cleanup: trim fragments → strip all quote variants → enforce long-tail + vendor + banned
  tags = tags
    .map((t) => trimBrokenTail(t.trim()))
    .map((t) =>
      t
        .replace(/["""\u201C\u201D'''\u2018\u2019]/g, "")
        .replace(/\s{2,}/g, " ")
        .replace(/\|\s*\|/g, "|")
        .trim()
    )
    .filter(tagQualifies);

  // Re-dedupe — enforce 255 chars per individual tag (Shopify limit), no combined string limit
  tags = dedupeBySignature(tags, 255);
  let tagsString = tags.join(", ");

  // URL handle
  const rawHandle = raw.url_handle || sanitizePlainText(raw.title || product.title || "", 100);
  const url_handle = sanitizeHandle(rawHandle);


  title = finalHardClean(title);
  tagsString = finalHardClean(tagsString);
  const cleanHandle = finalHardClean(url_handle);

  // Clean a single image alt string:
  // - Replace curly/smart quotes with straight equivalents (GMC bans them)
  // - Strip internal brand/DBA names from EVERYWHERE (the AI often writes the wrong store name)
  // - Collapse duplicates like "Iron Phoenix GHG - Iron Phoenix GHG"
  // - Remove a trailing "| " with nothing useful after it
  function cleanAltText(alt: string): string {
    const BRAND_ALT_RE = /\b(iron phoenix ghg|iron phoenix|our phoenix rise|go hard gaming discord llc|go hard gaming discord|go hard gaming|ghg|phoenix flow)\b/gi;
    // Replace smart/curly quotes with straight equivalents
    let cleaned = alt
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'");
    // Strip brand names from the ENTIRE string (both before and after the pipe)
    cleaned = cleaned.replace(BRAND_ALT_RE, "");
    // Collapse any "X - X" or "X | X" duplicates left behind
    cleaned = cleaned.replace(/([A-Za-z][\w\s]{2,}?)\s*[-]\s*\1/gi, "$1");
    // Clean up orphaned pipes, dashes, and excess whitespace
    cleaned = cleaned
      .replace(/\|\s*\|/g, "|")          // double pipes
      .replace(/[-–]\s*\|/g, "|")         // "- |"
      .replace(/\|\s*[-–]?\s*$/g, "")     // trailing "| " with nothing after
      .replace(/\s{2,}/g, " ")
      .replace(/[-\s]+$/, "")
      .trim();
    return cleaned.slice(0, 125).trim();
  }

  function cleanImageAltsJson(raw_alts: string): string {
    try {
      const parsed: { image_id: number; alt: string }[] = JSON.parse(raw_alts);
      if (!Array.isArray(parsed)) return raw_alts;
      return JSON.stringify(parsed.map((entry) => ({ ...entry, alt: cleanAltText(entry.alt || "") })));
    } catch {
      return raw_alts;
    }
  }

  const rawImageAlts = typeof raw.image_alts === "string"
    ? raw.image_alts
    : Array.isArray(raw.image_alts)
      ? JSON.stringify(raw.image_alts)
      : "";

  const normalizedImageAlts = rawImageAlts ? cleanImageAltsJson(rawImageAlts) : "";

  const normalizedImageFilenames = typeof raw.image_filenames === "string"
    ? raw.image_filenames
    : Array.isArray(raw.image_filenames)
      ? JSON.stringify(raw.image_filenames)
      : "";

  return {
    title,
    body_html,
    seo_title: cleanSeoTitle,
    seo_description: cleanSeoDescription,
    product_type,
    tags: tagsString,
    variant_suggestions: sanitizePlainText(raw.variant_suggestions || "", 240),
    url_handle: cleanHandle,
    faq_json: raw.faq_json || "",
    collections_suggestion: sanitizePlainText(raw.collections_suggestion || "", 300),
    image_alts: normalizedImageAlts,
    image_filenames: normalizedImageFilenames,
    reasoning: appendValidationNotes(raw.reasoning, notes),
  };
}
