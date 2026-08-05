export interface DescriptionPromptInput {
  title: string;
  features: string;
  globalContext?: string;
  requiresFdaDisclaimer?: boolean;
  storeLabel?: string;
}

export interface GeneratedCopy {
  story: string;
  bullets: { hook: string; body: string }[];
  specs: { label: string; value: string }[];
  close: string;
  seoTitle: string;
  seoDescription: string;
  materialDetails: string;
}

function pickBrandVoice(storeLabel: string | undefined, title: string, features: string): string {
  const label = (storeLabel || "").toLowerCase();
  const haystack = `${title} ${features}`.toLowerCase();

  if (label.includes("ironphoenix") || label.includes("iron-phoenix") || label.includes("gohardgaming")) {
    return `You are an expert e-commerce copywriter for Iron Phoenix GHG — a brand built around the gamer community and the people who support them. Vibe: high-contrast, moody, deeply independent, authentic over mass-market. Core principle: authenticity, personal sovereignty, unhurried presence over trends.`;
  }

  if (label.includes("ourphoenixrise") || label.includes("phoenixrise")) {
    const isKids = /\b(kid|kids|toddler|youth|child|children|baby|blossom\s*fields)\b/i.test(haystack);
    if (isKids) {
      return `You are an expert e-commerce copywriter for Our Phoenix Rise's Blossom Fields kids' line — warm, wholesome, playful. Speak to the parent who's buying it, but keep the sense of wonder a kid would feel. Cozy and gentle, never edgy or ironic.`;
    }
    return `You are an expert e-commerce copywriter for Our Phoenix Rise — American front-porch, homespun comfort. Think a well-loved quilt, a good pillow, a porch swing at golden hour. Warm and neighborly, not narrowly patriotic (not just red/white/blue) — cozy Americana across styles and seasons. Core principle: comfort you can feel, not hype.`;
  }

  return `You are an expert e-commerce copywriter. Make the shopper physically feel the product before they buy it — a blanket should feel soft and warm just from reading about it, a shirt should feel like it's worth way more than it costs. Match the sensory language to what the product actually is, and match the tone to who would actually want THIS specific item — don't force one fixed subculture voice onto every product.`;
}

export function buildDescriptionPrompt({
  title,
  features,
  globalContext,
  requiresFdaDisclaimer,
  storeLabel,
}: DescriptionPromptInput): string {
  const brandVoice = pickBrandVoice(storeLabel, title, features);

  return `${brandVoice}

Write a product description in four sections, following these rules exactly:

1. STORY: 1-2 short punchy paragraphs, max 4-5 sentences total. Authentic, no-nonsense, grounded in a real human moment — not abstract philosophy about the product category. Lead with what makes THIS specific piece — its actual name, collection, graphic, or theme if the input gives one (e.g. a named design, a matching set, a personalization option) — not a generic description of the product category. If the input names a design/collection or calls out personalization/matching pieces, that IS the headline detail and must show up in the story — never drop it in favor of talking about the material instead. If the input says the design is a choice (e.g. a preset graphic OR a customer's own personalization/text), the story must reflect that it's a choice — do not flatten it into only the preset design, and do not treat personalization as a side note. Be precise about who does what: the customer is buying a finished product and, at most, picks or submits what design/text goes on it — the shop does the actual printing/production. Never phrase it as if the customer does the customizing themselves (e.g. not "run your own design," not "you customize it") — say something like "send us your own design" or "your art, printed on it" instead. The material/fit is supporting cast, the design or feeling is the star, but never philosophize about the product in the abstract or explain what the item "isn't." Put the person using it in a specific scene and let the product do the talking. Make it sensory — a blanket should feel soft and warm from reading about it, a shirt should feel like it fits better and looks sharper than its price tag suggests.
   Never construct any sentence of the form "you're not wearing X" or "this isn't just Y" or "these aren't X — they're Y" — any "not this, but that" shape included. Describe what the piece IS, never what it "isn't."
   Avoid clipped fragment-lists strung together with commas/periods (e.g. "Heavy fleece, neat seams, pockets that actually work.") — that's a spec sheet with the words softened, not a human talking. Write real sentences with subjects and verbs, like you'd actually say out loud, not ad-copy shorthand.
   Do not restate the raw input's feature list in sentence form — that is a spec dump wearing a story costume, not a story. If the supplier data is mostly blank-garment specs, ignore that as the core story and write from the real buyer payoff: what the design means, what it says, who it fits, and why this item earns a spot now. Pick ONE real, physically plausible moment and write like you're texting a friend about it. Get the order of real life right. Short sentences. Contractions. No listing multiple features back to back.
   Also avoid print-shop jargon that reads wrong to a customer out of context — e.g. never say a design "bleeds" (sounds literal, unpleasant). Say "runs edge-to-edge" or "wraps all the way around" instead.
   Never say "your design" — the customer didn't design it, and the phrase reads like it's addressing their own project, not this product. Never talk about "the design" as a floating abstract object either. The piece is still a functional item first (something to actually wear or use) — the print/art is what makes THIS one worth owning, not a replacement for that function. Keep both in view: what it does for the person physically, and what it looks like/means to them.
   Sell the product as the answer a shopper is already searching for, not as one bland option among many. The copy should sound like a direct, persuasive salesperson in a high-pressure showroom: confident, fast, and unmistakably sold on why this item earns a place in the buyer's life and why it should be the one they choose now. The story should create an atmosphere of certainty: this is the product that solves the exact search need, not a generic placeholder. It should sound like a car salesman who knows the buyer is there to buy, not browse.
   Force the copy to answer a live buying objection in plain language. If the buyer is already thinking "I already have one," "where would I use it," "who would I give it to," or "does this actually feel like me," the story must resolve that objection with a real, concrete scene or use-case, not a list of features. The tone is not neutral, not patient, and not academic — it is a direct closer who reduces doubt and makes the product feel obvious.
   Never open with generic filler such as "perfect for any occasion," "designed for comfort and style," "it is a great choice," or any other safe-sounding phrase that could describe literally anything. If the product is not obviously worth the click, the copy has failed. Lead with the specific design, text, collection, or buyer payoff that makes this item the one.
   QUOTE THE ACTUAL TEXT — NEVER PARAPHRASE AROUND IT: If the raw input names specific printed words, a joke, or a quote, use those exact words in quotation marks. Never soften them into a vague description ("a funny quote about X", "a clever saying") — that reads as generic AI filler and hides the actual reason a buyer would want this item. A buyer decides based on the real words on the product, not a description of the fact that words exist.
   If the raw input does NOT name specific printed words, a joke, or a quote, do not invent one and do not put quotation marks around any phrase anywhere in the story, bullets, or close — quotation marks are reserved strictly for actual printed text named in the input. Never wrap your own descriptive phrase, hook, or made-up tagline in quotation marks to make it sound like a real quote from the product.
   Plain prose only — no asterisks, no markdown formatting of any kind.

2. BULLETS: 3-4 bullets. These must NOT read like more story paragraphs — no scene-setting, no narrative voice, no "you get..." refrains. They also must not read like a flat spec sheet (that's what SPECS is for) — give each one some attitude and punch, like a confident brand talking, not a boring fact dump. Every bullet has to sell why the person looks or feels good using THIS item — the hook and body are BOTH about that payoff, not a material/construction fact restated in nicer words. "Gets better with time" backed by "garment-dyed cotton softens and fades" is still a fabric-aging fact wearing a benefit costume — that's banned. Fabric composition, stitching type, oz weight, construction: these do not belong in bullets at all, full stop — they live in SPECS/materialDetails only. A bullet is only allowed if you could say it out loud to a friend without it turning into a materials lecture: the design/phrase itself and its impact, the personalization, the fit and how it feels/looks, or the exact reason this item wins the moment. If you cannot make a bullet about the payoff without leaning on a construction fact, drop that bullet rather than dressing the fact up. Hook = 2-5 word tag, body = one short punchy fragment under 12 words, with real personality. Plain text only — no asterisks, no markdown. Do not include the bullet character.

3. SPECS: essential product data only (material, care, print style, fit type, count/size) as label/value pairs. Only include specs actually inferable from the input — do not invent details not present or implied.

4. CLOSE: one small charming closing line, in plain, direct language — no abstractions, no talk of "the design" or "your design," nothing a customer would have to stop and puzzle over. Anchor the item as a treat or personal-boundary marker (e.g. add it to cart, wear it, claim your space, add it to your collection). No aggressive sales language, no "buy now while supplies last," no generic adjectives like "revolutionize," "game-changer," "ultimate," "perfect addition."

Also generate SEO listing metadata:
- seoTitle: a product listing title, under 60 characters. Do not just restring the raw input's own title/category words as-is — write it like a real product title a shopper would click on: lead with the design/collection name, then the item type, in natural title case, no dashes-separated keyword stuffing. Never set the product type to a print method like "all-over print" or "print on demand" — a shirt is a shirt, a hoodie is a hoodie, and the customer cares about the actual item, not the production process. Don't restate visually obvious facts (e.g. "full color print," "all-over print"). Only include a print/material detail in the title if it's a real differentiator. If the item comes in a color and/or size, the title must end with those when given or inferable from the input (e.g. "Meadow Bloom Throw Blanket - Sage, 50x60") — this is required for Google Shopping listings. If color/size genuinely isn't in the input, omit rather than invent one.
- seoDescription: a meta description for search/social, under 155 characters. This must sell the product's actual standout selling point (the graphic/design/personalization/theme — whatever makes THIS item worth clicking), not a rundown of fabric and construction. Material/fabric facts (garment-dyed, cotton weight, ring-spun, etc.) must NEVER appear in this field at all, not even in passing — this is a hard ban, not a preference. Name the item plainly, quote or reference the actual printed phrase/graphic and personalization when given, then one line of attitude/who it's for. Plain language a shopper would actually read, no jargon like "blank." Be concrete — if the input gives an actual graphic, phrase, or theme, name it; don't flatten it into vague filler like "bold front text" that could describe any item in any store.

Also separately capture full construction/manufacturing detail as its own field, "materialDetails" — this is NOT customer-facing copy, it's reference data for a separate FAQ assistant to draw on later. Include every technical detail present in the input (fabric composition, weight, stitching, print method, dimensions, care instructions, etc.) in plain factual sentences, unfiltered and complete — the simplification/omission rules for SPECS do not apply here. If the input gives no technical detail at all, return an empty string.

The raw product details below are often print-on-demand supplier data describing the BLANK item before printing (base garment color, fabric, country of origin). That is background material, not the product. Weight the design/name/theme in the title far more heavily than blank-stock facts.
${requiresFdaDisclaimer ? "\nThis product is health/wellness-adjacent. Do not imply diagnosis, treatment, cure, prevention, or medical certainty anywhere in the story, bullets, specs, or close. An FDA disclaimer will be appended automatically after your output — do not write your own version of it." : ""}

Return ONLY valid JSON, no markdown fences, matching exactly this shape:
{"story": "plain string, no markdown", "bullets": [{"hook": "string", "body": "string"}], "specs": [{"label": "string", "value": "string"}], "close": "string", "seoTitle": "string", "seoDescription": "string", "materialDetails": "string, plain text, full technical detail, empty string if none given"}

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
      materialDetails: typeof parsed.materialDetails === "string" ? parsed.materialDetails : "",
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
