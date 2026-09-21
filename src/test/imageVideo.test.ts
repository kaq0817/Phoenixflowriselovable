import { describe, expect, it } from "vitest";
import { classifyProductImage, pickBestImages, slideLayersAt } from "../lib/imageVideo";

const cdn = (name: string) => `https://cdn.shopify.com/s/files/1/0001/products/${name}?v=1758000000`;

// A realistic product: supplier photos, our mockups, our cards, a size chart.
const images = [
  { src: cdn("blanket-of-love-front.jpg"), alt: "Blanket of love", position: 1 },
  { src: cdn("blanket-size-chart.jpg"), alt: "Size chart", position: 2 },
  { src: cdn("blanket-of-love-shipping.webp"), alt: "Blanket of Love - Shipping Info", position: 3 },
  { src: cdn("blanket-of-love-lifestyle-mockup-our-phoenix-rise.webp"), alt: "Blanket - lifestyle mockup | Our Phoenix Rise", position: 4 },
  { src: cdn("blanket-of-love-promise.webp"), alt: "Blanket of Love - Our Promise", position: 5 },
  { src: cdn("blanket-of-love-features.webp"), alt: "Blanket of Love - Made With Care", position: 6 },
  { src: cdn("blanket-of-love-close-up.jpg"), alt: "Close up of the print", position: 7 },
  { src: cdn("blanket-of-love-styled-mockup-our-phoenix-rise.webp"), alt: "Blanket - styled mockup", position: 8 },
  { src: cdn("blanket-of-love-social.webp"), alt: "Blanket of Love - Why You'll Love It", position: 9 },
  { src: cdn("blanket-of-love-variations.webp"), alt: "Blanket of Love - Design Options", position: 10 },
];

describe("picks the images that sell", () => {
  it("classifies each kind", () => {
    const kinds = images.map((i) => classifyProductImage(i.src, i.alt, i.position).kind);
    expect(kinds).toEqual(["hero", "reference", "shipping", "mockup", "promise", "features", "photo", "mockup", "social", "options"]);
  });
  it("puts the main photo first, mockups next, and never picks shipping/promise/size chart", () => {
    const picked = pickBestImages(images);
    expect(picked).toHaveLength(5);
    expect(picked[0]).toBe(0);                    // main photo
    expect(picked.slice(1, 3)).toEqual([3, 7]);   // the two mockups
    expect(picked[3]).toBe(5);                    // features card
    expect(picked).not.toContain(1);              // size chart
    expect(picked).not.toContain(2);              // shipping card
    expect(picked).not.toContain(4);              // promise card
  });
  it("returns fewer than 5 rather than padding with irrelevant images", () => {
    const few = [images[0], images[1], images[2], images[4]];
    expect(pickBestImages(few)).toEqual([0]);
  });
});

describe("slide timing", () => {
  it("plays each of 5 slides for 2 seconds with a half-second fade into the next", () => {
    expect(slideLayersAt(0, 5)).toEqual([{ index: 0, alpha: 1, progress: 0 }]);
    const mid = slideLayersAt(1.75, 5); // 0.25s into the fade
    expect(mid).toHaveLength(2);
    expect(mid[1].index).toBe(1);
    expect(mid[1].alpha).toBeCloseTo(0.5, 5);
    expect(slideLayersAt(2.5, 5)[0].index).toBe(1);
    // last slide never tries to fade into a slide that doesn't exist
    expect(slideLayersAt(9.9, 5)).toHaveLength(1);
    expect(slideLayersAt(9.9, 5)[0].index).toBe(4);
  });
  it("works for a single image", () => {
    expect(slideLayersAt(5, 1)).toHaveLength(1);
  });
});
