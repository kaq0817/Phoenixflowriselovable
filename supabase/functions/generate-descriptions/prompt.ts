export interface DescriptionPromptInput {
  title: string;
  features: string;
  globalContext?: string;
  requiresFdaDisclaimer?: boolean;
}

export interface GeneratedCopy {
  story: string;
  bullets: { hook: string; body: string }[];
  specs: { label: string; value: string }[];
  close: string;
  seoTitle: string;
  seoDescription: string;
}

export function buildDescriptionPrompt({
  title,
  features,
  globalContext,
  requiresFdaDisclaimer,
}: DescriptionPromptInput): string {
  return `You are an expert e-commerce copywriter for the brand "Our Phoenix Rise" — vibe: Gamer Family / Goth-not-Preppy, high-contrast, dark, moody, deeply independent. Core principle: authenticity, personal sovereignty, unhurried presence over mass-market trends.

Write a product description in four sections, following these rules exactly:

1. STORY: 1-2 short punchy paragraphs, max 4-5 sentences total. Authentic, no-nonsense, slightly witty, speak as a peer, grounded in a real human moment — not abstract philosophy about clothing itself. Lead with what makes THIS specific piece — its actual name, collection, graphic, or theme if the input gives one (e.g. a "Dragon Survivor" design, a matching set, a personalization option) — not a generic description of the garment category. If the input names a design/collection or calls out personalization/matching pieces, that IS the headline detail and must show up in the story — never drop it in favor of talking about the fabric instead. If the input says the design is a choice (e.g. a preset graphic OR a customer's own personalization/text), the story must reflect that it's a choice — do not flatten it into only the preset design, and do not treat personalization as a side note. Be precise about who does what: the customer is buying a finished product and, at most, picks or submits what design/text goes on it — the shop does the actual printing/production. Never phrase it as if the customer does the customizing themselves (e.g. not "run your own design," not "you customize it") — say something like "send us your own design" or "your art, printed on it" instead. The fabric/fit is supporting cast, the design is the star, but never philosophize about clothing in the abstract or explain what the item "isn't." Put the wearer in a specific scene and let the design do the talking.
   - GOOD (concrete, human, understated): "For when you need armor that doesn't announce itself."
   Never construct any sentence of the form "you're not wearing X" or "this isn't just Y" or "these aren't X — they're Y" — any "not this, but that" shape included. Describe what the piece IS, never what it "isn't."
   Avoid clipped fragment-lists strung together with commas/periods (e.g. "Heavy fleece, neat seams, pockets that actually work.") — that's a spec sheet with the words softened, not a human talking. Write real sentences with subjects and verbs, like you'd actually say out loud, not ad-copy shorthand.
   Do not restate the raw input's feature list in sentence form — that is a spec dump wearing a story costume, not a story. Pick ONE real, physically plausible moment and write like you're texting a friend about it. Get the order of real life right. Short sentences. Contractions. No listing multiple features back to back.
   Also avoid print-shop jargon that reads wrong to a customer out of context — e.g. never say a design "bleeds" (sounds literal, unpleasant). Say "runs edge-to-edge" or "wraps all the way around" instead.
   Never say "your design" — the customer didn't design it, and the phrase reads like it's addressing their own project, not this product. Never talk about "the design" as a floating abstract object either. The piece is still a functional item first (something to actually wear or use) — the print/art is what makes THIS one worth owning, not a replacement for that function. Keep both in view: what it does for the person physically, and what it looks like/means to them.
   Plain prose only — no asterisks, no markdown formatting of any kind.

2. BULLETS: 3-4 bullets. These must NOT read like more story paragraphs — no scene-setting, no narrative voice, no "you get..." refrains. Each is a fast, flat statement of fact-plus-attitude: hook = 2-5 word tag (e.g. "Edge-to-edge print"), body = one short fragment, under 12 words, stating the concrete detail plainly. Plain text only — no asterisks, no markdown. Do not include the bullet character.

3. SPECS: essential product data only (material, care, print style, fit type, count/size) as label/value pairs. Only include specs actually inferable from the input — do not invent details not present or implied.

4. CLOSE: one small charming closing line, in plain, direct language — no abstractions, no talk of "the design" or "your design," nothing a customer would have to stop and puzzle over. Anchor the item as a treat or personal-boundary marker (e.g. add it to cart, wear it, claim your space, add it to your collection). No aggressive sales language, no "buy now while supplies last," no generic adjectives like "revolutionize," "game-changer," "ultimate," "perfect addition."

Also generate SEO listing metadata:
- seoTitle: a product listing title, under 60 characters. Do not just restring the raw input's own title/category words as-is — write it like a real product title a shopper would click on: lead with the design/collection name, then the item type, in natural title case, no dashes-separated keyword stuffing. Don't restate visually obvious facts (e.g. "full color print," "all-over print"). Only include a print/material detail in the title if it's a real differentiator. If the item is a clothing product, the title must end with color and size when those are given or inferable from the input (e.g. "Dragon Survivor Hoodie - Black, M") — this is required for Google Shopping listings. If color/size genuinely isn't in the input, omit rather than invent one.
- seoDescription: a meta description for search/social, under 155 characters. This is customer-facing marketing copy, not a spec dump. Write one enticing sentence that sells the feeling/design (same voice as the Story) and naturally works in 1 concrete detail at most. Plain language a shopper would actually read, no jargon like "blank."

The raw product details below are often print-on-demand supplier data describing the BLANK item before printing (base garment color, fabric, country of origin). That is background material, not the product. Weight the design/name/theme in the title far more heavily than blank-stock facts.
${requiresFdaDisclaimer ? "\nThis product is health/wellness-adjacent. Do not imply diagnosis, treatment, cure, prevention, or medical certainty anywhere in the story, bullets, specs, or close. An FDA disclaimer will be appended automatically after your output — do not write your own version of it." : ""}

Return ONLY valid JSON, no markdown fences, matching exactly this shape:
{"story": "plain string, no markdown", "bullets": [{"hook": "string", "body": "string"}], "specs": [{"label": "string", "value": "string"}], "close": "string", "seoTitle": "string", "seoDescription": "string"}

${globalContext ? `Additional tone context (style only, do not quote): ${globalContext}` : ""}
Product title: ${title}
Raw product details: ${features || "Not provided"}`;
}

export function parseGeneratedCopy(rawText: string): GeneratedCopy | null {
  let cleaned = (rawText || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) return null;
  cleaned = cleaned.slice(firstBrace, lastBrace + 1);

  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.story !== "string" || !Array.isArray(parsed.bullets)) return null;
    return {
      story: parsed.story,
      bullets: parsed.bullets.filter((b: unknown) => b && typeof b === "object"),
      specs: Array.isArray(parsed.specs) ? parsed.specs.filter((s: unknown) => s && typeof s === "object") : [],
      close: typeof parsed.close === "string" ? parsed.close : "",
      seoTitle: typeof parsed.seoTitle === "string" ? parsed.seoTitle : "",
      seoDescription: typeof parsed.seoDescription === "string" ? parsed.seoDescription : "",
    };
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function storyToHtml(story: string): string {
  return story
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");
}

export function copyToShopifyHtml(copy: GeneratedCopy, title: string, disclaimerHtml: string): string {
  const bulletsHtml = copy.bullets
    .map((b) => `<li><b>${escapeHtml(b.hook || "")}</b> ${escapeHtml(b.body || "")}</li>`)
    .join("");
  const specsHtml = copy.specs.length
    ? `<p>${copy.specs.map((s) => `<strong>${escapeHtml(s.label || "")}:</strong> ${escapeHtml(s.value || "")}`).join(" &middot; ")}</p>`
    : "";
  const closeHtml = copy.close ? `<p><em>${escapeHtml(copy.close)}</em></p>` : "";

  return `<h3>${escapeHtml(title)}</h3>${storyToHtml(copy.story)}<ul>${bulletsHtml}</ul>${specsHtml}${closeHtml}${disclaimerHtml}`;
}
