// Values Google Shopping will reject or warn on as a "color" — shared between the
// check-google-feed scanner and the fix-google-feed-color writer so the two never
// drift out of sync on what counts as a real color.
export const VAGUE_COLOR_VALUES = new Set([
  "default", "default title", "n/a", "na", "none", "no color", "other",
  "os", "one size", "standard", "regular", "mixed", "assorted", "various",
  "multicolor", "multi", "color", "colour", "", ".", "-", "–", "—",
]);
