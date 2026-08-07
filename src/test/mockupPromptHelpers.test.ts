import { describe, expect, it } from "vitest";
import { buildMockupContextNote } from "../../supabase/functions/_shared/mockupPromptHelpers";

describe("buildMockupContextNote", () => {
  it("adds a grinder cue for whole bean coffee products", () => {
    const note = buildMockupContextNote({
      title: "Organic Whole Bean Coffee",
      product_type: "coffee",
      tags: ["whole bean", "coffee"],
    });

    expect(note).toContain("grinder");
    expect(note).toContain("whole bean coffee");
  });

  it("does not add a grinder cue for pre-ground coffee", () => {
    const note = buildMockupContextNote({
      title: "Pre-Ground Coffee Blend",
      product_type: "coffee",
      tags: ["ground coffee"],
    });

    expect(note).toBe("");
  });

  it("handles Shopify's comma-separated tags string without throwing", () => {
    // Shopify's REST Admin API returns product.tags as a single string, not an
    // array — this must not throw "(product.tags || []).map is not a function".
    const note = buildMockupContextNote({
      title: "Organic Whole Bean Coffee",
      product_type: "coffee",
      tags: "Organic, Fair Trade, Whole Bean",
    });

    expect(note).toContain("grinder");
  });
});
