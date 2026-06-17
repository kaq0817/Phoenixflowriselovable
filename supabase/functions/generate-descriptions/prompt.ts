export interface DescriptionPromptInput {
  title: string;
  features: string;
  globalContext?: string;
  requiresFdaDisclaimer?: boolean;
}

export function buildDescriptionPrompt({
  title,
  features,
  globalContext,
  requiresFdaDisclaimer,
}: DescriptionPromptInput): string {
  const disclaimerBlock = requiresFdaDisclaimer
    ? `
- REQUIRED: End with this exact FDA disclaimer paragraph:
  <p><em>*These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease.</em></p>`
    : "";

  return `You are writing a Shopify product description in HTML.

YOUR RESPONSE MUST BE EXACTLY THIS STRUCTURE — NO DEVIATIONS:

<h3>[Product name]</h3>
<p>[One sentence: what this product is and who it is for. No hype.]</p>
<ul>
<li>[Specific feature — pulled directly from the feature list]</li>
<li>[Specific feature — pulled directly from the feature list]</li>
<li>[Specific feature — pulled directly from the feature list]</li>
<li>[Specific feature — pulled directly from the feature list]</li>
</ul>
<p>[One sentence: practical use context.]</p>
${disclaimerBlock ? disclaimerBlock.trim() : ""}

RULES — VIOLATIONS WILL BREAK THE OUTPUT:
- Raw HTML only. Do NOT use markdown, asterisks, dashes, backticks, or any non-HTML formatting.
- Do NOT write prose paragraphs. Do NOT write "When X is a priority..." or any motivational opener.
- Each <li> must come from the feature list. Do not invent specs.
- Do not use words like "empower", "invest", "companion", "journey", "transform", or marketing superlatives.
- Do not imply diagnosis, treatment, cure, prevention, or medical certainty.
- No <html>, <body>, <head>, or markdown code fences.
- No explanation, preamble, or commentary outside the HTML block.

${globalContext ? `Tone context (style only, do not quote): ${globalContext}` : ""}
Product title: ${title}
Feature list: ${features || "Not provided"}`;
}

export function normalizeGeneratedHtml(rawHtml: string, title: string, features: string, requiresFdaDisclaimer: boolean): string {
  let cleaned = rawHtml
    .replace(/^```html?\s*/i, "")
    .replace(/```\s*$/, "")
    .replace(/<\/?(body|html|meta|DOCTYPE)[^>]*>/gi, "")
    .replace(/\r/g, "")
    .trim();

  // Rescue markdown bullet lists (* or -) if Gemini ignored the HTML instruction
  if (!/<ul\b/i.test(cleaned) && /^\s*[\*\-]\s+.+/m.test(cleaned)) {
    cleaned = cleaned.replace(
      /((?:^\s*[\*\-]\s+.+\n?)+)/gm,
      (block) => {
        const items = block
          .split("\n")
          .map((line) => line.replace(/^\s*[\*\-]\s+/, "").trim())
          .filter(Boolean)
          .map((item) => `<li>${item}</li>`)
          .join("\n");
        return `<ul>\n${items}\n</ul>`;
      },
    );
  }

  // Rescue bare text paragraphs (lines not already in an HTML tag)
  if (!/<p\b/i.test(cleaned)) {
    cleaned = cleaned
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => (/<[a-z]/i.test(block) ? block : `<p>${block}</p>`))
      .join("\n");
  }

  const hasHeading = /<h3\b[^>]*>.*<\/h3>/i.test(cleaned);
  const hasList = /<ul\b[^>]*>[\s\S]*<li\b[^>]*>[\s\S]*<\/li>/i.test(cleaned);
  const hasParagraph = /<p\b[^>]*>[\s\S]*<\/p>/i.test(cleaned);

  if (hasHeading && hasList && hasParagraph) {
    return cleaned;
  }

  // Hard fallback: build from features
  const bulletItems = (features || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);

  const fallbackList = bulletItems.length > 0
    ? bulletItems.map((item) => `<li>${item}</li>`).join("")
    : "<li>See product details for full specifications.</li>";

  const disclaimer = requiresFdaDisclaimer
    ? '<p><em>*These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease.</em></p>'
    : "";

  return `<h3>${title}</h3><p>Details for this product are listed below.</p><ul>${fallbackList}</ul><p>Use this information to confirm fit, size, and everyday use.</p>${disclaimer}`;
}
