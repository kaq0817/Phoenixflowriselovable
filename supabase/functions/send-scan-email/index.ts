import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

interface ComplianceFinding {
  category: string;
  severity: "critical" | "warning" | "info" | "pass";
  title: string;
  description: string;
  recommendation: string;
  reference?: string;
}

interface ListingFinding {
  type: string;
  severity: "critical" | "warning" | "info";
  field: string;
  message: string;
}

interface ListingWithFindings {
  listing_id: number | string;
  title: string;
  image: string | null;
  findings: ListingFinding[];
}

function categoryLabel(cat: string): string {
  const map: Record<string, string> = {
    gmc_misrepresentation: "GMC / Misrepresentation",
    etsy_compliance: "Etsy Compliance",
    general_ecommerce: "General E-Commerce",
  };
  return map[cat] || cat.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function scoreLabel(score: number): { label: string; color: string; bg: string } {
  if (score >= 90) return { label: "LOW RISK", color: "#15803d", bg: "#f0fdf4" };
  if (score >= 75) return { label: "MOSTLY COMPLIANT", color: "#166534", bg: "#dcfce7" };
  if (score >= 55) return { label: "MODERATE RISK", color: "#b45309", bg: "#fffbeb" };
  if (score >= 35) return { label: "HIGH RISK", color: "#c2410c", bg: "#fff7ed" };
  return { label: "CRITICAL RISK", color: "#b91c1c", bg: "#fef2f2" };
}

function renderSeverityBar(severity: string): string {
  const bars: Record<string, { left: string; right: string; label: string; border: string }> = {
    critical: { left: "#b91c1c", right: "#fca5a5", label: "CRITICAL", border: "#fca5a5" },
    warning:  { left: "#b45309", right: "#fcd34d", label: "WARNING",  border: "#fcd34d" },
    info:     { left: "#1d4ed8", right: "#93c5fd", label: "INFO",     border: "#93c5fd" },
    pass:     { left: "#15803d", right: "#86efac", label: "PASS",     border: "#86efac" },
  };
  const b = bars[severity] || bars.info;
  return `<td style="width:6px;padding:0;background:${b.left};border-radius:4px 0 0 4px;">&nbsp;</td>`;
}

function renderComplianceReport(
  findings: ComplianceFinding[],
  score: number,
  summary: string,
  storeUrl: string,
  pagesAnalyzed: number,
  appBaseUrl: string
): string {
  const criticals = findings.filter(f => f.severity === "critical");
  const warnings  = findings.filter(f => f.severity === "warning");
  const infos     = findings.filter(f => f.severity === "info");
  const passed    = findings.filter(f => f.severity === "pass");
  const sl        = scoreLabel(score);
  const scoreColor = score >= 80 ? "#15803d" : score >= 60 ? "#b45309" : "#b91c1c";
  const reportDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // ── Group findings by category for the risk table ──
  const categoryMap: Record<string, { critical: number; warning: number; info: number }> = {};
  for (const f of findings) {
    if (f.severity === "pass") continue;
    if (!categoryMap[f.category]) categoryMap[f.category] = { critical: 0, warning: 0, info: 0 };
    if (f.severity === "critical") categoryMap[f.category].critical++;
    else if (f.severity === "warning") categoryMap[f.category].warning++;
    else categoryMap[f.category].info++;
  }

  const categoryRows = Object.entries(categoryMap).map(([cat, counts]) => {
    const worstSeverity = counts.critical > 0 ? "critical" : counts.warning > 0 ? "warning" : "info";
    const badge = worstSeverity === "critical"
      ? `<span style="font-size:11px;font-weight:700;color:#b91c1c;background:#fef2f2;padding:2px 7px;border-radius:3px;">CRITICAL</span>`
      : worstSeverity === "warning"
      ? `<span style="font-size:11px;font-weight:700;color:#b45309;background:#fffbeb;padding:2px 7px;border-radius:3px;">WARNING</span>`
      : `<span style="font-size:11px;font-weight:700;color:#1d4ed8;background:#eff6ff;padding:2px 7px;border-radius:3px;">INFO</span>`;
    const total = counts.critical + counts.warning + counts.info;
    return `<tr style="border-top:1px solid #e5e7eb;">
      <td style="padding:9px 12px;color:#374151;font-size:13px;">${categoryLabel(cat)}</td>
      <td style="padding:9px 12px;text-align:center;color:#374151;font-size:13px;">${total}</td>
      <td style="padding:9px 12px;">${badge}</td>
    </tr>`;
  }).join("");

  // ── Finding card renderer ──
  function findingCard(f: ComplianceFinding, num: number): string {
    const leftColors: Record<string, string> = {
      critical: "#dc2626", warning: "#d97706", info: "#2563eb", pass: "#16a34a"
    };
    const leftColor = leftColors[f.severity] || "#6b7280";
    const headerBg = f.severity === "critical" ? "#fef2f2"
      : f.severity === "warning" ? "#fffbeb"
      : f.severity === "info" ? "#eff6ff" : "#f9fafb";
    const severityText = f.severity === "critical" ? "#b91c1c"
      : f.severity === "warning" ? "#b45309"
      : f.severity === "info" ? "#1d4ed8" : "#15803d";

    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto 16px;border:1px solid #e5e7eb;border-radius:8px;border-left:4px solid ${leftColor};border-collapse:separate;background:#fff;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td style="padding:14px 18px;background:${headerBg};border-radius:6px 6px 0 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <span style="font-size:10px;font-weight:800;color:${severityText};letter-spacing:0.08em;text-transform:uppercase;">${f.severity}</span>
                &nbsp;&nbsp;
                <span style="font-size:10px;color:#9ca3af;letter-spacing:0.05em;text-transform:uppercase;">${categoryLabel(f.category)}</span>
              </td>
              <td style="text-align:right;font-size:12px;color:#9ca3af;font-weight:600;">#${String(num).padStart(2, "0")}</td>
            </tr>
          </table>
          <p style="margin:6px 0 0;font-size:15px;font-weight:700;color:#111827;">${f.title}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 18px;">
          <p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.65;">${f.description}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5ff;border-left:3px solid #7c3aed;border-radius:0 6px 6px 0;">
            <tr>
              <td style="padding:11px 14px;">
                <p style="margin:0 0 4px;font-size:11px;font-weight:800;color:#7c3aed;letter-spacing:0.07em;text-transform:uppercase;">&#9654; Action Required</p>
                <p style="margin:0;color:#374151;font-size:13px;line-height:1.6;">${f.recommendation}</p>
              </td>
            </tr>
          </table>
          ${f.reference ? `<p style="margin:10px 0 0;font-size:12px;color:#9ca3af;">Reference: <a href="${f.reference}" style="color:#7c3aed;text-decoration:none;">${f.reference}</a></p>` : ""}
        </td>
      </tr>
    </table>`;
  }

  let findingIndex = 1;
  let sectionsHtml = "";

  if (criticals.length > 0) {
    sectionsHtml += `
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:28px auto 16px;">
      <tr>
        <td>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="border-top:2px solid #dc2626;">&nbsp;</td>
            </tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
            <tr>
              <td style="font-size:13px;font-weight:800;color:#b91c1c;letter-spacing:0.08em;text-transform:uppercase;padding:4px 0;">&#9888; CRITICAL ISSUES &mdash; ${criticals.length}</td>
              <td style="text-align:right;font-size:12px;color:#b91c1c;">Immediate action required</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    ${criticals.map(f => findingCard(f, findingIndex++)).join("")}`;
  }

  if (warnings.length > 0) {
    sectionsHtml += `
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:28px auto 16px;">
      <tr>
        <td>
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:2px solid #d97706;">&nbsp;</td></tr></table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
            <tr>
              <td style="font-size:13px;font-weight:800;color:#b45309;letter-spacing:0.08em;text-transform:uppercase;padding:4px 0;">&#9657; WARNINGS &mdash; ${warnings.length}</td>
              <td style="text-align:right;font-size:12px;color:#b45309;">Address before next review cycle</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    ${warnings.map(f => findingCard(f, findingIndex++)).join("")}`;
  }

  if (infos.length > 0) {
    sectionsHtml += `
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:28px auto 16px;">
      <tr>
        <td>
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:2px solid #3b82f6;">&nbsp;</td></tr></table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
            <tr>
              <td style="font-size:13px;font-weight:800;color:#1d4ed8;letter-spacing:0.08em;text-transform:uppercase;padding:4px 0;">&#9432; PRE-RISK FLAGS &mdash; ${infos.length}</td>
              <td style="text-align:right;font-size:12px;color:#1d4ed8;">Monitor before they escalate</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    ${infos.map(f => findingCard(f, findingIndex++)).join("")}`;
  }

  if (passed.length > 0) {
    const passedItems = passed.map(p => `
      <tr>
        <td style="width:20px;padding:7px 6px 7px 4px;vertical-align:top;color:#15803d;font-size:16px;">&#10003;</td>
        <td style="padding:7px 0;font-size:13px;color:#166534;border-top:1px solid #dcfce7;">${p.title}</td>
      </tr>`).join("");
    sectionsHtml += `
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:28px auto 0;">
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:2px solid #16a34a;">&nbsp;</td></tr></table>
        <p style="font-size:13px;font-weight:800;color:#15803d;letter-spacing:0.08em;text-transform:uppercase;margin:6px 0 12px;">&#10003; PASSED CHECKS &mdash; ${passed.length}</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:8px;padding:4px 14px;">
          <tr><td>
            <table width="100%" cellpadding="0" cellspacing="0">${passedItems}</table>
          </td></tr>
        </table>
      </td></tr>
    </table>`;
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
  <tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">

      <!-- HEADER -->
      <tr>
        <td style="background:#1e1b4b;padding:20px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <p style="margin:0;font-size:18px;font-weight:800;color:#a78bfa;letter-spacing:0.04em;">PHOENIX FLOW</p>
                <p style="margin:2px 0 0;font-size:12px;color:#6d6a9c;letter-spacing:0.06em;text-transform:uppercase;">E-Commerce Compliance Audit</p>
              </td>
              <td style="text-align:right;">
                <p style="margin:0;font-size:12px;color:#9ca3af;">${reportDate}</p>
                <p style="margin:2px 0 0;font-size:11px;color:#6d6a9c;">Confidential &bull; For Recipient Only</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- STORE + SCORE BAND -->
      <tr>
        <td style="background:#312e81;padding:24px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:middle;">
                <p style="margin:0;font-size:11px;color:#a5b4fc;letter-spacing:0.08em;text-transform:uppercase;">Store Audited</p>
                <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#ffffff;">${storeUrl || "N/A"}</p>
                <p style="margin:6px 0 0;font-size:12px;color:#a5b4fc;">${pagesAnalyzed ?? 0} pages analyzed &bull; ${findings.length} findings</p>
              </td>
              <td style="text-align:right;vertical-align:middle;padding-left:24px;">
                <p style="margin:0;font-size:48px;font-weight:900;color:${score >= 80 ? "#4ade80" : score >= 60 ? "#fbbf24" : "#f87171"};line-height:1;">${score ?? "?"}</p>
                <p style="margin:2px 0 0;font-size:11px;color:#a5b4fc;">/100</p>
                <p style="margin:6px 0 0;font-size:11px;font-weight:800;letter-spacing:0.07em;color:${score >= 80 ? "#4ade80" : score >= 60 ? "#fbbf24" : "#f87171"};background:rgba(0,0,0,0.3);padding:3px 9px;border-radius:4px;display:inline-block;">${sl.label}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- SCORE BREAKDOWN PILLS -->
      <tr>
        <td style="background:#eef2ff;padding:14px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="text-align:center;padding:0 6px;">
                <p style="margin:0;font-size:22px;font-weight:800;color:#b91c1c;">${criticals.length}</p>
                <p style="margin:2px 0 0;font-size:10px;color:#b91c1c;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">Critical</p>
              </td>
              <td style="text-align:center;padding:0 6px;border-left:1px solid #c7d2fe;">
                <p style="margin:0;font-size:22px;font-weight:800;color:#b45309;">${warnings.length}</p>
                <p style="margin:2px 0 0;font-size:10px;color:#b45309;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">Warnings</p>
              </td>
              <td style="text-align:center;padding:0 6px;border-left:1px solid #c7d2fe;">
                <p style="margin:0;font-size:22px;font-weight:800;color:#1d4ed8;">${infos.length}</p>
                <p style="margin:2px 0 0;font-size:10px;color:#1d4ed8;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">Pre-Risk</p>
              </td>
              <td style="text-align:center;padding:0 6px;border-left:1px solid #c7d2fe;">
                <p style="margin:0;font-size:22px;font-weight:800;color:#15803d;">${passed.length}</p>
                <p style="margin:2px 0 0;font-size:10px;color:#15803d;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">Passed</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- FINDINGS BY RISK AREA TABLE -->
      ${categoryRows ? `
      <tr>
        <td style="padding:24px 32px 0;">
          <p style="margin:0 0 10px;font-size:11px;font-weight:800;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;">Risk Area Breakdown</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <tr style="background:#f9fafb;">
              <td style="padding:9px 12px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Risk Area</td>
              <td style="padding:9px 12px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;text-align:center;">Issues</td>
              <td style="padding:9px 12px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Severity</td>
            </tr>
            ${categoryRows}
          </table>
        </td>
      </tr>` : ""}

      <!-- EXECUTIVE SUMMARY -->
      ${summary ? `
      <tr>
        <td style="padding:24px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;">
            <tr>
              <td style="padding:16px 20px;">
                <p style="margin:0 0 6px;font-size:11px;font-weight:800;color:#7c3aed;letter-spacing:0.08em;text-transform:uppercase;">Executive Summary</p>
                <p style="margin:0;color:#374151;font-size:14px;line-height:1.7;">${summary}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>` : ""}

      <!-- ALL FINDINGS -->
      <tr>
        <td style="padding:8px 32px 32px;">
          ${sectionsHtml}
        </td>
      </tr>

      <!-- CTA -->
      <tr>
        <td style="background:#f9fafb;padding:28px 32px;border-top:1px solid #e5e7eb;text-align:center;">
          <a href="${appBaseUrl}/audit" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:13px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Open Full Report in Phoenix Flow</a>
          <p style="margin:14px 0 0;font-size:12px;color:#9ca3af;">Log in to view live findings, apply fixes, and rescan at any time.</p>
        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td style="background:#1e1b4b;padding:16px 32px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#6d6a9c;">Phoenix Flow &mdash; Autonomous E-Commerce Intelligence &bull; This report is confidential and generated for the account holder only.</p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function renderListingFindings(listings: ListingWithFindings[]): string {
  if (!listings || listings.length === 0) return "";
  let html = `<h2 style="margin:32px 0 16px;color:#111827;font-size:18px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;">Listings with Issues (${listings.length})</h2>`;

  for (const listing of listings) {
    const critCount = listing.findings.filter(f => f.severity === "critical").length;
    const warnCount = listing.findings.filter(f => f.severity === "warning").length;
    const leftColor = critCount > 0 ? "#dc2626" : warnCount > 0 ? "#d97706" : "#3b82f6";
    html += `
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-left:4px solid ${leftColor};border-radius:8px;margin-bottom:16px;background:#fff;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td style="padding:14px 18px;border-bottom:1px solid #f3f4f6;">
          <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#111827;">${listing.title}</p>
          <span style="font-size:11px;color:#6b7280;">${listing.findings.length} issue${listing.findings.length !== 1 ? "s" : ""}${critCount > 0 ? ` &mdash; <span style="color:#b91c1c;font-weight:700;">${critCount} critical</span>` : ""}${warnCount > 0 ? ` &mdash; <span style="color:#b45309;font-weight:700;">${warnCount} warning</span>` : ""}</span>
        </td>
      </tr>
      ${listing.findings.map(f => {
        const sColors: Record<string, string> = { critical: "#b91c1c", warning: "#b45309", info: "#1d4ed8" };
        const sBg: Record<string, string> = { critical: "#fef2f2", warning: "#fffbeb", info: "#eff6ff" };
        const sc = sColors[f.severity] || "#6b7280";
        const sb = sBg[f.severity] || "#f9fafb";
        return `<tr>
          <td style="padding:10px 18px;border-bottom:1px solid #f9fafb;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:top;width:70px;padding-right:10px;">
                  <span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:800;background:${sb};color:${sc};letter-spacing:0.05em;text-transform:uppercase;">${f.severity}</span>
                </td>
                <td style="vertical-align:top;">
                  <p style="margin:0 0 2px;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;">${f.field}</p>
                  <p style="margin:0;color:#374151;font-size:13px;line-height:1.5;">${f.message}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
      }).join("")}
    </table>`;
  }
  return html;
}

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
      findings,
    } = await req.json();

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const MAIL_FROM = Deno.env.get("MAIL_FROM") || "Phoenix Flow <no-reply@ironphoenixflow.com>";
    const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://ironphoenixflow.com";

    const isComplianceReport = reportType === "compliance";
    const subject = isComplianceReport
      ? `Compliance Audit: ${storeUrl || "Store"} &mdash; Score ${score ?? "N/A"}/100 &bull; ${criticalCount ?? 0} critical, ${warningCount ?? 0} warnings`
      : `Listing Scan Complete: ${listingsWithIssues} of ${totalScanned} listings need attention`;

    let html: string;

    if (isComplianceReport) {
      html = renderComplianceReport(
        findings || [],
        score ?? 0,
        summary || "",
        storeUrl || "",
        pagesAnalyzed ?? 0,
        APP_BASE_URL
      );
    } else {
      html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
  <tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td style="background:#1e1b4b;padding:20px 32px;">
          <p style="margin:0;font-size:18px;font-weight:800;color:#a78bfa;">PHOENIX FLOW</p>
          <p style="margin:2px 0 0;font-size:12px;color:#6d6a9c;letter-spacing:0.06em;text-transform:uppercase;">Listing Scan Report${storeUrl ? ` &mdash; ${storeUrl}` : ""}</p>
        </td>
      </tr>
      <tr>
        <td style="background:#eef2ff;padding:14px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="text-align:center;padding:0 8px;">
                <p style="margin:0;font-size:24px;font-weight:800;color:#111827;">${totalScanned || 0}</p>
                <p style="margin:2px 0 0;font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;">Scanned</p>
              </td>
              <td style="text-align:center;padding:0 8px;border-left:1px solid #c7d2fe;">
                <p style="margin:0;font-size:24px;font-weight:800;color:${listingsWithIssues > 0 ? "#b91c1c" : "#15803d"};">${listingsWithIssues || 0}</p>
                <p style="margin:2px 0 0;font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;">With Issues</p>
              </td>
              <td style="text-align:center;padding:0 8px;border-left:1px solid #c7d2fe;">
                <p style="margin:0;font-size:24px;font-weight:800;color:#b91c1c;">${(summary && summary.critical_count) || 0}</p>
                <p style="margin:2px 0 0;font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;">Critical</p>
              </td>
              <td style="text-align:center;padding:0 8px;border-left:1px solid #c7d2fe;">
                <p style="margin:0;font-size:24px;font-weight:800;color:#b45309;">${(summary && summary.warning_count) || 0}</p>
                <p style="margin:2px 0 0;font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;">Warnings</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px;">
          ${renderListingFindings(findings || [])}
          ${findings && findings.length === 25 ? `<p style="color:#6b7280;font-size:13px;text-align:center;margin-top:8px;">Showing top 25 listings with issues &mdash; open the full report for all results.</p>` : ""}
        </td>
      </tr>
      <tr>
        <td style="background:#f9fafb;padding:24px 32px;border-top:1px solid #e5e7eb;text-align:center;">
          <a href="${APP_BASE_URL}/listing-scan" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:13px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Open Full Report in Phoenix Flow</a>
        </td>
      </tr>
      <tr>
        <td style="background:#1e1b4b;padding:16px 32px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#6d6a9c;">Phoenix Flow &mdash; Autonomous E-Commerce Intelligence</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
    }

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

  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

interface ComplianceFinding {
  category: string;
  severity: "critical" | "warning" | "info" | "pass";
  title: string;
  description: string;
  recommendation: string;
  reference?: string;
}

interface ListingFinding {
  type: string;
  severity: "critical" | "warning" | "info";
  field: string;
  message: string;
}

interface ListingWithFindings {
  listing_id: number | string;
  title: string;
  image: string | null;
  findings: ListingFinding[];
}

function severityBadge(severity: string): string {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    critical: { bg: "#fef2f2", text: "#b91c1c", label: "CRITICAL" },
    warning:  { bg: "#fffbeb", text: "#b45309", label: "WARNING" },
    info:     { bg: "#eff6ff", text: "#1d4ed8", label: "INFO" },
    pass:     { bg: "#f0fdf4", text: "#15803d", label: "PASS" },
  };
  const s = map[severity] || map.info;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:${s.bg};color:${s.text};letter-spacing:0.05em;">${s.label}</span>`;
}

function renderComplianceFindings(findings: ComplianceFinding[]): string {
  if (!findings || findings.length === 0) return "";
  const actionable = findings.filter(f => f.severity !== "pass");
  const passed = findings.filter(f => f.severity === "pass");
  const order = ["critical", "warning", "info"];
  const sorted = [...actionable].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

  let html = `<h2 style="margin:32px 0 16px;color:#111827;font-size:18px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;">Findings (${actionable.length})</h2>`;

  for (const f of sorted) {
    html += `
    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;margin-bottom:14px;background:#fff;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
        ${severityBadge(f.severity)}
        <span style="font-size:12px;color:#6b7280;background:#f3f4f6;padding:2px 8px;border-radius:4px;">${f.category}</span>
        <strong style="color:#111827;font-size:15px;">${f.title}</strong>
      </div>
      <p style="margin:0 0 8px;color:#374151;font-size:14px;line-height:1.6;">${f.description}</p>
      <div style="background:#f9fafb;border-left:3px solid #7c3aed;padding:10px 14px;border-radius:0 6px 6px 0;margin-top:10px;">
        <strong style="font-size:12px;color:#7c3aed;text-transform:uppercase;letter-spacing:0.05em;">Recommendation</strong>
        <p style="margin:4px 0 0;color:#374151;font-size:14px;line-height:1.6;">${f.recommendation}</p>
      </div>
      ${f.reference ? `<p style="margin:8px 0 0;font-size:12px;color:#9ca3af;">Reference: <a href="${f.reference}" style="color:#7c3aed;">${f.reference}</a></p>` : ""}
    </div>`;
  }

  if (passed.length > 0) {
    html += `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 18px;margin-top:8px;">
      <strong style="color:#15803d;font-size:14px;">&#10003; ${passed.length} checks passed</strong>
      <ul style="margin:8px 0 0;padding-left:20px;color:#166534;font-size:13px;">
        ${passed.map(p => `<li style="margin-bottom:4px;">${p.title}</li>`).join("")}
      </ul>
    </div>`;
  }

  return html;
}

function renderListingFindings(listings: ListingWithFindings[]): string {
  if (!listings || listings.length === 0) return "";
  let html = `<h2 style="margin:32px 0 16px;color:#111827;font-size:18px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;">Listings with Issues (${listings.length})</h2>`;

  for (const listing of listings) {
    const critCount = listing.findings.filter(f => f.severity === "critical").length;
    const warnCount = listing.findings.filter(f => f.severity === "warning").length;
    html += `
    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;margin-bottom:16px;background:#fff;">
      <div style="margin-bottom:12px;">
        <strong style="color:#111827;font-size:15px;display:block;margin-bottom:4px;">${listing.title}</strong>
        <div style="display:inline-flex;gap:6px;flex-wrap:wrap;">
          ${critCount > 0 ? `<span style="font-size:11px;font-weight:700;background:#fef2f2;color:#b91c1c;padding:2px 8px;border-radius:4px;">${critCount} critical</span>` : ""}
          ${warnCount > 0 ? `<span style="font-size:11px;font-weight:700;background:#fffbeb;color:#b45309;padding:2px 8px;border-radius:4px;">${warnCount} warning</span>` : ""}
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        ${listing.findings.map(f => `
        <tr style="border-top:1px solid #f3f4f6;">
          <td style="padding:8px 8px 8px 0;width:80px;vertical-align:top;">${severityBadge(f.severity)}</td>
          <td style="padding:8px 0;vertical-align:top;">
            <span style="font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase;">${f.field}</span>
            <p style="margin:3px 0 0;color:#374151;font-size:13px;line-height:1.5;">${f.message}</p>
          </td>
        </tr>`).join("")}
      </table>
    </div>`;
  }
  return html;
}

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
      findings,
    } = await req.json();

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const MAIL_FROM = Deno.env.get("MAIL_FROM") || "Phoenix Flow <no-reply@ironphoenixflow.com>";
    const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://ironphoenixflow.com";

    const isComplianceReport = reportType === "compliance";
    const subject = isComplianceReport
      ? `Compliance Report: ${storeUrl || "Store"} scored ${score ?? "N/A"}/100 — ${criticalCount ?? 0} critical issues`
      : `Listing Scan Complete: ${listingsWithIssues} of ${totalScanned} listings need attention`;

    const scoreColor = score >= 80 ? "#15803d" : score >= 60 ? "#b45309" : "#b91c1c";

    const html = isComplianceReport
      ? `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;padding:32px;">
        <div style="text-align:center;margin-bottom:28px;">
          <h1 style="color:#7c3aed;font-size:24px;margin:0;">Phoenix Flow</h1>
          <p style="color:#6b7280;margin-top:4px;">Compliance Report &mdash; ${storeUrl || "Store"}</p>
        </div>

        <div style="background:#f9fafb;border-radius:12px;padding:24px;margin-bottom:24px;">
          <h2 style="margin:0 0 16px;color:#111827;font-size:18px;">Audit Summary</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:8px 0;color:#6b7280;">Store</td>
              <td style="padding:8px 0;text-align:right;font-weight:600;color:#111827;">${storeUrl || "N/A"}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;">Compliance Score</td>
              <td style="padding:8px 0;text-align:right;font-weight:700;font-size:20px;color:${scoreColor};">${score ?? "N/A"}/100</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;">Pages Analyzed</td>
              <td style="padding:8px 0;text-align:right;font-weight:600;color:#111827;">${pagesAnalyzed ?? 0}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;">Critical Issues</td>
              <td style="padding:8px 0;text-align:right;font-weight:600;color:#b91c1c;">${criticalCount ?? 0}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;">Warnings</td>
              <td style="padding:8px 0;text-align:right;font-weight:600;color:#b45309;">${warningCount ?? 0}</td>
            </tr>
          </table>
        </div>

        ${summary ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px 20px;margin-bottom:24px;"><p style="margin:0;color:#1e40af;font-size:14px;line-height:1.7;">${summary}</p></div>` : ""}

        ${renderComplianceFindings(findings || [])}

        <div style="text-align:center;margin-top:32px;">
          <a href="${APP_BASE_URL}/audit"
             style="display:inline-block;background:#7c3aed;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">
            Open Full Report in Phoenix Flow
          </a>
        </div>

        <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:32px;">
          Phoenix Flow &mdash; Autonomous E-Commerce Intelligence
        </p>
      </div>
    `
      : `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;padding:32px;">
        <div style="text-align:center;margin-bottom:28px;">
          <h1 style="color:#7c3aed;font-size:24px;margin:0;">Phoenix Flow</h1>
          <p style="color:#6b7280;margin-top:4px;">Listing Scan Complete${storeUrl ? ` &mdash; ${storeUrl}` : ""}</p>
        </div>

        <div style="background:#f9fafb;border-radius:12px;padding:24px;margin-bottom:24px;">
          <h2 style="margin:0 0 16px;color:#111827;font-size:18px;">Scan Summary</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:8px 0;color:#6b7280;">Listings Scanned</td>
              <td style="padding:8px 0;text-align:right;font-weight:600;color:#111827;">${totalScanned}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;">Listings With Issues</td>
              <td style="padding:8px 0;text-align:right;font-weight:600;color:${listingsWithIssues > 0 ? "#b91c1c" : "#15803d"};">${listingsWithIssues}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;">Critical Issues</td>
              <td style="padding:8px 0;text-align:right;font-weight:600;color:#b91c1c;">${(summary && summary.critical_count) || 0}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;">Warnings</td>
              <td style="padding:8px 0;text-align:right;font-weight:600;color:#b45309;">${(summary && summary.warning_count) || 0}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;">Total Issues</td>
              <td style="padding:8px 0;text-align:right;font-weight:600;color:#111827;">${(summary && summary.total_issues) || 0}</td>
            </tr>
          </table>
        </div>

        ${renderListingFindings(findings || [])}

        ${findings && findings.length === 25 ? `<p style="color:#6b7280;font-size:13px;text-align:center;">Showing top 25 listings with issues. Open the full report for all results.</p>` : ""}

        <div style="text-align:center;margin-top:32px;">
          <a href="${APP_BASE_URL}/listing-scan"
             style="display:inline-block;background:#7c3aed;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">
            Open Full Report in Phoenix Flow
          </a>
        </div>

        <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:32px;">
          Phoenix Flow &mdash; Autonomous E-Commerce Intelligence
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


