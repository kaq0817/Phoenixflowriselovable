import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      to,
      reportType = "listing",
      summary,
      listingsWithIssues,
      totalScanned,
      storeUrl,
      score,
      criticalCount,
      warningCount,
      pagesAnalyzed,
    } = await req.json();

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const MAIL_FROM = Deno.env.get("MAIL_FROM") || "Phoenix Flow <no-reply@ironphoenixflow.com>";
    const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://ironphoenixflow.com";

    const isComplianceReport = reportType === "compliance";
    const subject = isComplianceReport
      ? `Compliance Report Ready: ${storeUrl || "Store"} scored ${score ?? "N/A"}/100`
      : `?? Scan Complete: ${listingsWithIssues} of ${totalScanned} listings need attention`;

    const html = isComplianceReport
      ? `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #7c3aed; font-size: 24px; margin: 0;">Phoenix Flow</h1>
          <p style="color: #6b7280; margin-top: 4px;">Compliance Report Ready</p>
        </div>

        <div style="background: #f9fafb; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
          <h2 style="margin: 0 0 16px; color: #111827; font-size: 18px;">Audit Summary</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Store</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #111827;">${storeUrl || "N/A"}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Compliance Score</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #111827;">${score ?? "N/A"}/100</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Pages Analyzed</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #111827;">${pagesAnalyzed ?? 0}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Critical Issues</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #ef4444;">${criticalCount ?? 0}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Warnings</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #f59e0b;">${warningCount ?? 0}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center;">
          <a href="${APP_BASE_URL}/audit"
             style="display: inline-block; background: #7c3aed; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            View Full Report ?
          </a>
        </div>

        <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 32px;">
          Phoenix Flow — Autonomous E-Commerce Intelligence
        </p>
      </div>
    `
      : `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #7c3aed; font-size: 24px; margin: 0;">?? Phoenix Flow</h1>
          <p style="color: #6b7280; margin-top: 4px;">Listing Scan Complete</p>
        </div>
        
        <div style="background: #f9fafb; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
          <h2 style="margin: 0 0 16px; color: #111827; font-size: 18px;">Scan Summary</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Listings Scanned</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #111827;">${totalScanned}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Listings With Issues</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: ${listingsWithIssues > 0 ? "#ef4444" : "#10b981"};">${listingsWithIssues}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Critical Issues</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #ef4444;">${summary.critical_count || 0}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Warnings</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #f59e0b;">${summary.warning_count || 0}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center;">
          <a href="${APP_BASE_URL}/listing-scan" 
             style="display: inline-block; background: #7c3aed; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            View Full Report ?
          </a>
        </div>

        <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 32px;">
          Phoenix Flow — Autonomous E-Commerce Intelligence
        </p>
      </div>
    `;

    if (RESEND_API_KEY) {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + RESEND_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: MAIL_FROM,
          to,
          subject,
          html,
        }),
      });

      if (!emailRes.ok) {
        const errText = await emailRes.text();
        console.error("Email send failed:", errText);
      }
    } else {
      console.warn("RESEND_API_KEY not configured; skipping email send.");
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("send-scan-email error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


