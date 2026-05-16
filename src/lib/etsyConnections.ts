import { isEtsyPlatform } from "@/lib/storePlatforms";

export type EtsyConnectionLike = {
  platform: string;
  shop_domain: string | null;
  shop_name?: string | null;
  scopes?: string | null;
};

export function isEtsyConnected(connection: EtsyConnectionLike): boolean {
  return isEtsyPlatform(connection.platform);
}

export function isEtsyOAuthConnected(connection: EtsyConnectionLike): boolean {
  if (!isEtsyConnected(connection)) return false;
  return (connection.scopes || "").includes("shops_r");
}
