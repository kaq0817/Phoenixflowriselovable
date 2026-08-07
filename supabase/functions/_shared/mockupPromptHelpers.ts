type MockupProductContext = {
  title?: string;
  product_type?: string;
  // Shopify's REST Admin API returns a product's tags as a single comma-separated
  // string (e.g. "Organic, Fair Trade, Whole Bean"), not an array — but callers that
  // build this object by hand (tests, other integrations) may reasonably pass an
  // array instead. Accept either shape rather than assuming one.
  tags?: string[] | string;
};

const lower = (value?: string) => (value || "").toLowerCase();

const containsAny = (value: string, patterns: string[]) =>
  patterns.some((pattern) => value.includes(pattern));

function normalizeTags(tags?: string[] | string): string[] {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === "string") return tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  return [];
}

export function buildMockupContextNote(product: MockupProductContext): string {
  const title = lower(product.title);
  const productType = lower(product.product_type);
  const tags = normalizeTags(product.tags).map((tag) => lower(tag));
  const haystack = [title, productType, ...tags].join(" ");

  const wholeBeanCoffee = containsAny(haystack, ["whole bean", "whole-bean", "whole beans", "whole coffee bean", "coffee beans"])
    && !containsAny(haystack, ["ground coffee", "pre-ground", "ground beans", "instant coffee", "coffee grounds"]);

  if (!wholeBeanCoffee) {
    return "";
  }

  return `
PRODUCT CONTEXT:
The source product is whole bean coffee intended for home grinding. Show a grinder or grinder-adjacent setup in the lifestyle scene so the shopper understands this is whole beans for grinding at home, while keeping the exact coffee product as the hero.
`;
}
