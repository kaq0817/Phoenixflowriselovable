import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

interface DomainFact {
  type: "app_domain" | "store_domain" | "pillar_domain";
  host: string;
  label: string;
  description: string;
}

interface AppIdentityConfig {
  appName: string;
  legalName: string;
  domains: DomainFact[];
  assistantRules: string[];
  notes: string[];
  updatedAt: string;
}

interface AppSupportModule {
  id: string;
  name: string;
  route: string;
  audience: string;
  summary: string;
  steps: string[];
  notes: string[];
}

interface AppSupportConfig {
  purpose: string;
  audience: string;
  modules: AppSupportModule[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("Gemini API key not configured");

    const { question, identity, support } = await req.json() as {
      question?: string;
      identity?: AppIdentityConfig;
      support?: AppSupportConfig;
    };

    if (!question?.trim()) {
      return new Response(JSON.stringify({ error: "A question is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!identity?.appName || !Array.isArray(identity.domains) || identity.domains.length === 0) {
      return new Response(JSON.stringify({ error: "A valid app identity config is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!support?.purpose || !Array.isArray(support.modules) || support.modules.length === 0) {
      return new Response(JSON.stringify({ error: "A valid app support config is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const identityBlock = JSON.stringify(identity, null, 2);
    const supportBlock = JSON.stringify(support, null, 2);

    const systemPrompt = `You are a customer-facing product support assistant for ${identity.appName}.

Follow these rules exactly:
- App-Aware Context: Always treat domain names as specific typed facts (app_domain, store_domain, pillar_domain). They are not interchangeable.
- No Implicit Mutation: Never change routing, OAuth origins, or production domains unless explicitly commanded with a confirmation step.
- Knowledge First: Prioritize "Here is how this works in the app" over "I'll switch it now."
- Entity Source of Truth: Use the provided app identity config as the absolute source of truth for what domain is what.

Behavior requirements:
- Your main job is helping Phoenix Flow customers use the app's features.
- Use the support config to answer how to use Templanator, Etsy integration, Product Optimizer, and Listing Scanner.
- If the user mentions a domain that is not present in the identity config, say that it is not in the current source of truth.
- If the user asks a domain-sensitive change question, explain the impact first and say explicit confirmation is required before changing production routing or OAuth origins.
- Do not claim to have changed anything.
- Answer concisely, directly, and in plain ASCII only.`;

    const userPrompt = `App identity config:\n${identityBlock}\n\nApp support config:\n${supportBlock}\n\nUser question:\n${question}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": GEMINI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          generationConfig: {
            temperature: 0.2,
            topP: 0.8,
            maxOutputTokens: 700,
          },
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Assistant response failed (${response.status}): ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const answer = data.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "")
      .join("")
      .trim();

    if (!answer) {
      throw new Error("Assistant returned an empty answer");
    }

    return new Response(JSON.stringify({ answer }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("answer-app-question error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
