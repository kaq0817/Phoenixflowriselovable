export interface AppSupportModule {
  id: string;
  name: string;
  route: string;
  audience: string;
  summary: string;
  steps: string[];
  notes: string[];
}

export interface AppSupportConfig {
  purpose: string;
  audience: string;
  modules: AppSupportModule[];
}

export const appSupportConfig: AppSupportConfig = {
  purpose: "Help Phoenix Flow customers understand how to use the app's main workflows.",
  audience: "Consumers of Phoenix Flow who need product help, not internal engineering changes.",
  modules: [
    {
      id: "templanator",
      name: "Templanator",
      route: "/templanator",
      audience: "Shopify merchants repairing and improving theme quality.",
      summary: "Imports the active Shopify theme, scans speed/legal/pillar issues, previews deterministic fixes, and pushes approved theme files back to Shopify.",
      steps: [
        "Open Templanator and choose a connected Shopify store.",
        "Run the theme handshake to import the live theme into the scanner.",
        "Review the Architect scan for LCP, preload, lazy-loading, footer identity, policy links, support silos, and collection pillar suggestions.",
        "Map the rewrite inputs, generate the preview, and review file-by-file changes.",
        "Approve the files you want and push the selected changes back to Shopify.",
      ],
      notes: [
        "Templanator is a Shopify theme workflow, not an Etsy listing tool.",
        "It can detect pillar suggestions and cross-store link leakage before you push changes.",
      ],
    },
    {
      id: "etsy-integration",
      name: "Etsy Integration",
      route: "/settings",
      audience: "Users connecting Etsy so Phoenix Flow can read and update Etsy listings.",
      summary: "Starts Etsy OAuth from Settings, returns with a signed callback result, and stores the Etsy shop connection for optimizer tools.",
      steps: [
        "Open Settings and choose Add Etsy Shop.",
        "Start the Etsy connection flow and authorize the requested scopes.",
        "Return to Settings and confirm the Etsy connected message.",
        "Go to the Optimizer or Listing Scanner to load Etsy listings from the connected shop.",
      ],
      notes: [
        "The Etsy connection uses OAuth and should be started from Settings.",
        "If the Etsy shop is not connected, listing tools will ask the user to connect Etsy first.",
      ],
    },
    {
      id: "product-optimizer",
      name: "Product Optimizer",
      route: "/optimizer",
      audience: "Users editing one Shopify product or one Etsy listing at a time.",
      summary: "Loads products or listings from a connected store, generates AI suggestions, and lets the user apply the approved changes back to Shopify or Etsy.",
      steps: [
        "Open Optimizer and select Shopify or Etsy.",
        "Choose the connected store or shop, then refresh to load products or listings.",
        "Pick the item to optimize and wait for Phoenix Flow to generate suggestions.",
        "Review the title, description, tags, SEO, and other proposed changes.",
        "Apply the approved changes back to the selected store.",
      ],
      notes: [
        "This is the main editor flow for one item at a time.",
        "Shopify and Etsy use the same page but different data and apply actions.",
      ],
    },
    {
      id: "listing-scan",
      name: "Listing Scanner",
      route: "/listing-scan",
      audience: "Users scanning many Etsy or Shopify items for issues before editing.",
      summary: "Runs a bulk issue scan, scores listings, and highlights spelling, duplicate keywords, missing tags, and weak descriptions.",
      steps: [
        "Open Listing Scanner and select the connected store or shop.",
        "Start the scan and wait for the job to process.",
        "Review findings by severity and open the items with issues.",
        "Use the findings to decide which items should go into the Optimizer next.",
      ],
      notes: [
        "Listing Scanner is triage, not direct editing.",
        "It helps users decide what to fix first before applying listing edits.",
      ],
    },
  ],
};
