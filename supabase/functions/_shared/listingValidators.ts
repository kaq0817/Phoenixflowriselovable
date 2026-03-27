const ASCII_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\u0018|\u0019/g, ""],
  [/\u000b|\f/g, " "],
  [/\r\n?/g, "\n"],
  [/[“”]/g, '"'],
  [/[‘’]/g, "'"],
  [/[–—]/g, "-"],
  [/•/g, "-"],
  [/[™®©]/g, ""],
  [/…/g, "..."],
  [/\u0000/g, ""],
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
];

const COLOR_WORDS = [
  "black", "white", "red", "blue", "green", "yellow", "orange", "purple", "pink", "brown", "tan", "beige",
  "gold", "silver", "gray", "grey", "navy", "teal", "maroon", "burgundy", "olive", "cream", "ivory", "khaki",
  "charcoal", "lavender", "mint", "coral", "turquoise", "bronze", "rose gold",
];

const SIZE_ORDER = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl", "4xl", "5xl"];

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
  variants?: ShopifyVariantLike[];
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
  reasoning?: string;
}

function replaceAscii(value: string): string {
  let next = value.normalize("NFKD");
  for (const [pattern, replacement] of ASCII_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }
  return next.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function collapseWhitespace(value: string): string {
  return value.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
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

function sanitizeHtml(value: string): string {
  return collapseWhitespace(replaceAscii(value || ""));
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
  const title = sanitizePlainText(raw.title || sourceTitle, 140) || sourceTitle;
  if ((raw.title || "") !== title) notes.push("title normalized to Etsy-safe length and ASCII");

  const description = sanitizePlainText(raw.description || listing.description || buildDefaultEtsyDescription(listing), 900);
  if (!raw.description) notes.push("description filled from existing listing context");

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

  let title = sanitizePlainText(raw.title || product.title || "", 70);
  if (apparel && requiredSuffix) {
    const normalizedTitle = normalizeKeywordPhrase(title);
    const normalizedSuffix = normalizeKeywordPhrase(requiredSuffix);
    if (!normalizedTitle.includes(normalizedSuffix)) {
      const sourceTitle = sanitizePlainText(product.title || "", 70);
      const core = sanitizePlainText(title.replace(new RegExp(requiredSuffix, "ig"), "").trim(), 70) || sourceTitle;
      title = sanitizePlainText(`${core} ${requiredSuffix}`.trim(), 70);
      notes.push("apparel title forced to keep real color and size range");
    }
  }

  const body_html = sanitizeHtml(
    raw.body_html || product.body_html || `<p>${sanitizePlainText(product.title || "This product")} is written to stay clear, factual, and easy to scan on Shopify.</p>`,
  );
  const seo_title = sanitizePlainText(raw.seo_title || title || product.metafields_global_title_tag || product.title || "", 70);
  const seo_description = sanitizePlainText(raw.seo_description || product.metafields_global_description_tag || title, 320);
  const product_type = sanitizePlainText(raw.product_type || product.product_type || "", 80);

  let tags = dedupeBySignature(String(raw.tags || product.tags || "").split(","), 40);
  if (apparel && requiredSuffix) {
    const color = extractColor(requiredSuffix);
    if (color && !tags.some((tag) => normalizeKeywordPhrase(tag) === normalizeKeywordPhrase(color))) {
      tags = dedupeBySignature([...tags, color], 40);
      notes.push("color tag restored for apparel");
    }
  }

  return {
    title,
    body_html,
    seo_title,
    seo_description,
    product_type,
    tags: tags.join(", "),
    variant_suggestions: sanitizePlainText(raw.variant_suggestions || "", 240),
    reasoning: appendValidationNotes(raw.reasoning, notes),
  };
}
