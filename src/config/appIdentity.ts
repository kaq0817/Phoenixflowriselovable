export type DomainFactType = "app_domain" | "store_domain" | "pillar_domain";

export interface DomainFact {
  type: DomainFactType;
  host: string;
  label: string;
  description: string;
}

export interface AppIdentityConfig {
  appName: string;
  legalName: string;
  domains: DomainFact[];
  assistantRules: string[];
  notes: string[];
  updatedAt: string;
}

export const appIdentityConfig: AppIdentityConfig = {
  appName: "Phoenix Flow",
  legalName: "Phoenix Flow",
  domains: [
    {
      type: "app_domain",
      host: "ironphoenixflow.com",
      label: "Primary app",
      description: "Authenticated dashboard, assistant, and default app-origin domain.",
    },
  ],
  assistantRules: [
    "App-Aware Context: Always treat domain names as specific typed facts (app_domain, store_domain, pillar_domain). They are not interchangeable.",
    "No Implicit Mutation: Never change routing, OAuth origins, or production domains unless explicitly commanded with a confirmation step.",
    "Knowledge First: Prioritize 'Here is what this means in the app' over 'I'll switch it now.'",
    "Entity Source of Truth: Use this app identity config as the absolute source of truth for what domain is what.",
  ],
  notes: [
    "If a domain is not listed here, the assistant should say it is not in the current source of truth instead of assuming it maps to an app, store, or pillar.",
    "Add store_domain and pillar_domain entries here before expecting the assistant to answer routing questions about them as facts.",
  ],
  updatedAt: "2026-03-27",
};

export const appDomainFacts = appIdentityConfig.domains.filter((fact) => fact.type === "app_domain");
export const storeDomainFacts = appIdentityConfig.domains.filter((fact) => fact.type === "store_domain");
export const pillarDomainFacts = appIdentityConfig.domains.filter((fact) => fact.type === "pillar_domain");

export function findDomainFact(host: string) {
  const normalizedHost = host.trim().toLowerCase();
  return appIdentityConfig.domains.find((fact) => fact.host.toLowerCase() === normalizedHost) || null;
}
