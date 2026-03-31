import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { hostname, routePath } = await req.json();
    const normalizedHost = String(hostname || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/\.$/, "");
    const rawPath = String(routePath || "").trim();
    const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;

    if (!normalizedHost) throw new Error("Missing hostname");
    if (!rawPath || normalizedPath === "/") throw new Error("Missing collection route");

    const requestedUrl = `https://${normalizedHost}${normalizedPath}`;
    const response = await fetch(requestedUrl, {
      redirect: "follow",
      headers: {
        "user-agent": "PhoenixFlowRouteVerifier/1.0",
      },
    });

    const finalUrl = response.url || requestedUrl;
    const final = new URL(finalUrl);
    const expectedPath = normalizedPath.replace(/\/+$/, "") || "/";
    const finalPath = final.pathname.replace(/\/+$/, "") || "/";
    const matchedHost = final.hostname.toLowerCase() === normalizedHost;
    const matchedRoute = finalPath === expectedPath || finalPath.startsWith(`${expectedPath}/`);
    const ok = response.ok && matchedHost && matchedRoute;

    return new Response(JSON.stringify({
      hostname: normalizedHost,
      routePath: normalizedPath,
      ok,
      status: response.status,
      finalUrl,
      matchedHost,
      matchedRoute,
      message: ok
        ? `${normalizedHost}${normalizedPath} resolved on the expected storefront route.`
        : `Live route mismatch. Final URL was ${finalUrl}.`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
