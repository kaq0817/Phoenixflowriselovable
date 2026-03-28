type StoreConnectionLike = {
  platform: string;
  shop_domain: string | null;
  shop_name: string | null;
};

function parseAdminStoreList(value: string | undefined): string[] {
  return (value || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeShopifyStore(value: string | null | undefined): string | null {
  if (!value) return null;

  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\/$/, "");
}

function normalizeEtsyStore(value: string | null | undefined): string | null {
  if (!value) return null;

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");

  const shopPathMatch = normalized.match(/etsy\.com\/shop\/([^/?#]+)/);
  if (shopPathMatch) return shopPathMatch[1];

  const subdomainMatch = normalized.match(/^([^.]+)\.etsy\.com$/);
  if (subdomainMatch) return subdomainMatch[1];

  return normalized.replace(/\/.*$/, "");
}

const shopifyAdminStores = new Set(
  parseAdminStoreList(import.meta.env.VITE_ADMIN_SHOPS).map(normalizeShopifyStore).filter(Boolean),
);

const etsyAdminStores = new Set(
  parseAdminStoreList(import.meta.env.VITE_ADMIN_ETSY_SHOPS || import.meta.env.VITE_ETSY_ADMIN_SHOPS)
    .map(normalizeEtsyStore)
    .filter(Boolean),
);

function matchesAdminStore(connection: StoreConnectionLike): boolean {
  if (connection.platform === "shopify") {
    if (shopifyAdminStores.size === 0) return true;
    const normalizedDomain = normalizeShopifyStore(connection.shop_domain);
    return !!normalizedDomain && shopifyAdminStores.has(normalizedDomain);
  }

  if (connection.platform === "etsy") {
    if (etsyAdminStores.size === 0) return true;

    const normalizedName = normalizeEtsyStore(connection.shop_name);
    const normalizedDomain = normalizeEtsyStore(connection.shop_domain);

    return (
      (!!normalizedName && etsyAdminStores.has(normalizedName)) ||
      (!!normalizedDomain && etsyAdminStores.has(normalizedDomain))
    );
  }

  return true;
}

export function scopeAdminStoreConnections<T extends StoreConnectionLike>(connections: T[], isAdmin: boolean): T[] {
  if (!isAdmin) return connections;
  return connections.filter(matchesAdminStore);
}

export function matchesStoreReference(connection: StoreConnectionLike, reference: string | null): boolean {
  if (!reference) return false;

  const normalizedReference = connection.platform === "etsy"
    ? normalizeEtsyStore(reference)
    : normalizeShopifyStore(reference);

  if (!normalizedReference) return false;

  if (connection.platform === "etsy") {
    return (
      normalizeEtsyStore(connection.shop_name) === normalizedReference ||
      normalizeEtsyStore(connection.shop_domain) === normalizedReference
    );
  }

  return normalizeShopifyStore(connection.shop_domain) === normalizedReference;
}
