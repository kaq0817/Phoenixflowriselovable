export function isGenericAlt(value: string): boolean {
  const normalized = String(value || "")
    .split("|")[0]
    .trim()
    .toLowerCase();

  return (
    /^product image(?:\s+\d+)?$/.test(normalized) ||
    /^image(?:\s+\d+)?$/.test(normalized) ||
    /^(product|item)(\s+(image|photo|view|detail))?(\s+\d+)?$/.test(normalized)
  );
}
