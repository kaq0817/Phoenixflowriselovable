import { describe, expect, it } from "vitest";
import { buildDescriptionPrompt } from "../../supabase/functions/generate-descriptions/prompt";

describe("buildDescriptionPrompt", () => {
  it("forces factual language and blocks unsupported medical claims", () => {
    const prompt = buildDescriptionPrompt({
      title: "Smartwatch with Blood Glucose Monitoring",
      features: "ECG monitoring, Bluetooth calling, 7-day battery, sleep tracking",
      globalContext: "Focus on accurate specs and practical daily use.",
      requiresFdaDisclaimer: false,
    });

    expect(prompt).toContain("Use only facts explicitly stated in the product title and feature list");
    expect(prompt).toContain("Do not imply diagnosis, treatment, cure, prevention, or medical certainty");
    expect(prompt).toContain("Avoid generic filler, vague hype, and supplier-style boilerplate");
    expect(prompt).not.toContain("make the person reading this description feel like they NEED to own this product");
  });
});
