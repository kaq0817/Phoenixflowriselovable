import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

interface DnsAnswer {
  name?: string;
  type?: number;
  TTL?: number;
  data?: string;
}

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

    const { hostname } = await req.json();
    const normalized = String(hostname || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
    if (!normalized) throw new Error("Missing hostname");

    const [aRes, cnameRes] = await Promise.all([
      fetch(`https://dns.google/resolve?name=${encodeURIComponent(normalized)}&type=A`),
      fetch(`https://dns.google/resolve?name=${encodeURIComponent(normalized)}&type=CNAME`),
    ]);
    const [aJson, cnameJson] = await Promise.all([aRes.json(), cnameRes.json()]);

    const aAnswers = (aJson.Answer || []) as DnsAnswer[];
    const cnameAnswers = (cnameJson.Answer || []) as DnsAnswer[];
    const exists = aAnswers.length > 0 || cnameAnswers.length > 0;

    return new Response(JSON.stringify({
      hostname: normalized,
      exists,
      aRecords: aAnswers.map((answer) => answer.data).filter(Boolean),
      cnameRecords: cnameAnswers.map((answer) => answer.data).filter(Boolean),
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
