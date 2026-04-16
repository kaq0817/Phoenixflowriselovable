import jsPDF from "jspdf";
import "jspdf-autotable";

// Extend jsPDF type for autotable
type AutoTableColor = number | [number, number, number];

type AutoTableCellContext = {
  column: { index: number };
  section: string;
  cell: {
    raw: unknown;
    styles: {
      textColor?: AutoTableColor;
    };
  };
};

type AutoTableOptions = {
  startY?: number;
  head: string[][];
  body: string[][];
  styles?: Record<string, unknown>;
  headStyles?: Record<string, unknown>;
  columnStyles?: Record<number, { cellWidth: number }>;
  didParseCell?: (data: AutoTableCellContext) => void;
};

declare module "jspdf" {
  interface jsPDF {
    autoTable: (options: AutoTableOptions) => jsPDF;
    lastAutoTable: { finalY: number };
  }
}

// ============================================================================
// CSV EXPORT
// ============================================================================

function escapeCsv(val: unknown): string {
  const str = String(val ?? "").replace(/"/g, '""');
  return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================
// COMPLIANCE SCANNER REPORTS
// ============================================================================

interface ComplianceFinding {
  category: string;
  severity: string;
  title: string;
  description: string;
  recommendation: string;
  reference?: string;
}

interface ComplianceReport {
  score: number;
  summary: string;
  findings: ComplianceFinding[];
  pages_analyzed: number;
}

export function exportComplianceCsv(report: ComplianceReport, storeUrl: string) {
  const headers = ["Severity", "Category", "Title", "Description", "Recommendation", "Reference"];
  const rows = report.findings.map((f) => [
    f.severity, f.category, f.title, f.description, f.recommendation, f.reference || "",
  ]);
  const csv = [headers.map(escapeCsv).join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\n");
  downloadFile(csv, `compliance-report-${storeUrl.replace(/[^a-zA-Z0-9]/g, "-")}.csv`, "text/csv");
}

export function exportCompliancePdf(report: ComplianceReport, storeUrl: string) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const criticals = report.findings.filter((f) => f.severity === "critical");
  const warnings = report.findings.filter((f) => f.severity === "warning");
  const passed = report.findings.filter((f) => f.severity === "pass");
  const infos = report.findings.filter((f) => f.severity === "info");

  const scoreColor: [number, number, number] =
    report.score >= 80 ? [34, 197, 94] : report.score >= 60 ? [234, 179, 8] : [239, 68, 68];

  const addPageFooter = (pageNum: number, totalPages: number) => {
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 160);
    doc.text("Phoenix Flow — Compliance Report", 14, pageH - 8);
    doc.text(`Page ${pageNum} of ${totalPages}`, pageW - 14, pageH - 8, { align: "right" });
    doc.text("Confidential — Prepared for authorized use only", pageW / 2, pageH - 8, { align: "center" });
  };

  // ── COVER PAGE ────────────────────────────────────────────────────────────
  // Dark header band
  doc.setFillColor(20, 10, 40);
  doc.rect(0, 0, pageW, 60, "F");

  // Accent bar
  doc.setFillColor(139, 92, 246);
  doc.rect(0, 57, pageW, 3, "F");

  // Report title
  doc.setFontSize(26);
  doc.setTextColor(255, 255, 255);
  doc.text("E-COMMERCE COMPLIANCE", pageW / 2, 28, { align: "center" });
  doc.setFontSize(18);
  doc.setTextColor(192, 160, 255);
  doc.text("AUDIT REPORT", pageW / 2, 40, { align: "center" });
  doc.setFontSize(9);
  doc.setTextColor(180, 180, 200);
  doc.text("Powered by Phoenix Flow", pageW / 2, 52, { align: "center" });

  // Score circle (drawn as filled circle + text)
  const cx = pageW / 2;
  const cy = 100;
  doc.setFillColor(...scoreColor);
  doc.circle(cx, cy, 22, "F");
  doc.setFillColor(20, 10, 40);
  doc.circle(cx, cy, 18, "F");
  doc.setFontSize(20);
  doc.setTextColor(...scoreColor);
  doc.text(String(report.score), cx, cy + 3, { align: "center" });
  doc.setFontSize(8);
  doc.setTextColor(160, 160, 160);
  doc.text("/ 100", cx, cy + 10, { align: "center" });
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text("COMPLIANCE SCORE", cx, cy + 30, { align: "center" });

  // Store + date block
  doc.setFillColor(248, 246, 255);
  doc.roundedRect(20, 140, pageW - 40, 40, 3, 3, "F");
  doc.setFontSize(9);
  doc.setTextColor(100, 80, 140);
  doc.text("STORE AUDITED", 30, 153);
  doc.setFontSize(11);
  doc.setTextColor(30, 20, 50);
  doc.text(storeUrl, 30, 162);
  doc.setFontSize(9);
  doc.setTextColor(100, 80, 140);
  doc.text("REPORT DATE", pageW / 2 + 10, 153);
  doc.setFontSize(11);
  doc.setTextColor(30, 20, 50);
  doc.text(`${dateStr} at ${timeStr}`, pageW / 2 + 10, 162);

  // Stat boxes
  const boxY = 198;
  const boxW = (pageW - 40) / 4;
  const boxes = [
    { label: "CRITICAL", count: criticals.length, color: [239, 68, 68] as [number, number, number] },
    { label: "WARNINGS", count: warnings.length, color: [234, 179, 8] as [number, number, number] },
    { label: "INFO", count: infos.length, color: [99, 102, 241] as [number, number, number] },
    { label: "PASSED", count: passed.length, color: [34, 197, 94] as [number, number, number] },
  ];
  boxes.forEach((box, i) => {
    const bx = 20 + i * (boxW + 2);
    doc.setFillColor(248, 246, 255);
    doc.roundedRect(bx, boxY, boxW, 28, 2, 2, "F");
    doc.setFontSize(18);
    doc.setTextColor(...box.color);
    doc.text(String(box.count), bx + boxW / 2, boxY + 13, { align: "center" });
    doc.setFontSize(7);
    doc.setTextColor(120, 100, 160);
    doc.text(box.label, bx + boxW / 2, boxY + 22, { align: "center" });
  });

  // Executive summary
  doc.setFontSize(12);
  doc.setTextColor(40, 30, 60);
  doc.text("Executive Summary", 20, 244);
  doc.setDrawColor(139, 92, 246);
  doc.setLineWidth(0.5);
  doc.line(20, 246, pageW - 20, 246);
  doc.setFontSize(9);
  doc.setTextColor(80, 70, 100);
  const summaryLines = doc.splitTextToSize(report.summary, pageW - 40);
  doc.text(summaryLines, 20, 253);

  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Pages Analyzed: ${report.pages_analyzed}`, 20, pageH - 18);

  // ── FINDINGS PAGES ────────────────────────────────────────────────────────
  const severityGroups = [
    { label: "Critical Issues", color: [239, 68, 68] as [number, number, number], items: criticals },
    { label: "Warnings", color: [234, 179, 8] as [number, number, number], items: warnings },
    { label: "Informational", color: [99, 102, 241] as [number, number, number], items: infos },
    { label: "Passed Checks", color: [34, 197, 94] as [number, number, number], items: passed },
  ].filter((g) => g.items.length > 0);

  severityGroups.forEach((group) => {
    doc.addPage();

    // Section header band
    doc.setFillColor(20, 10, 40);
    doc.rect(0, 0, pageW, 20, "F");
    doc.setFillColor(...group.color);
    doc.rect(0, 18, pageW, 2, "F");
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text(group.label.toUpperCase(), pageW / 2, 13, { align: "center" });

    doc.autoTable({
      startY: 26,
      head: [["Category", "Finding", "Recommendation"]],
      body: group.items.map((f) => [
        f.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        `${f.title}\n${f.description}`,
        f.recommendation + (f.reference ? `\nRef: ${f.reference}` : ""),
      ]),
      styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: group.color, textColor: 255, fontSize: 8, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 38 },
        1: { cellWidth: 82 },
        2: { cellWidth: 62 },
      },
    });
  });

  // Add footers to all pages
  const totalPages = (doc.internal as unknown as { pages: unknown[] }).pages.length - 1;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addPageFooter(i, totalPages);
  }

  downloadBlob(doc.output("blob"), `compliance-report-${storeUrl.replace(/[^a-zA-Z0-9]/g, "-")}-${now.toISOString().slice(0, 10)}.pdf`);
}

// ============================================================================
// THEME AUDIT REPORTS
// ============================================================================

interface ThemeFinding {
  category: string;
  severity: string;
  title: string;
  description: string;
  recommendation: string;
}

interface ContrastCheck {
  pair: string;
  foreground: string;
  background_color: string;
  ratio: number;
  wcag_aa: string;
  wcag_aaa: string;
}

interface ThemeReport {
  overall_score: number;
  summary: string;
  color_palette: Record<string, string>;
  contrast_checks: ContrastCheck[];
  findings: ThemeFinding[];
  category_scores: Record<string, number>;
}

export function exportThemeCsv(report: ThemeReport, storeUrl: string) {
  // Findings sheet
  const headers = ["Severity", "Category", "Title", "Description", "Recommendation"];
  const rows = report.findings.map((f) => [f.severity, f.category, f.title, f.description, f.recommendation]);

  // Contrast checks
  const contrastHeaders = ["Pair", "Foreground", "Background", "Ratio", "WCAG AA", "WCAG AAA"];
  const contrastRows = report.contrast_checks.map((c) => [
    c.pair, c.foreground, c.background_color, String(c.ratio), c.wcag_aa, c.wcag_aaa,
  ]);

  let csv = "=== FINDINGS ===\n";
  csv += [headers.map(escapeCsv).join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\n");
  csv += "\n\n=== CONTRAST CHECKS ===\n";
  csv += [contrastHeaders.map(escapeCsv).join(","), ...contrastRows.map((r) => r.map(escapeCsv).join(","))].join("\n");
  csv += "\n\n=== SCORES ===\n";
  csv += Object.entries(report.category_scores).map(([k, v]) => `${escapeCsv(k)},${v}`).join("\n");

  downloadFile(csv, `theme-audit-${storeUrl.replace(/[^a-zA-Z0-9]/g, "-")}.csv`, "text/csv");
}

export function exportThemePdf(report: ThemeReport, storeUrl: string) {
  const doc = new jsPDF();
  const now = new Date().toLocaleString();

  doc.setFontSize(20);
  doc.setTextColor(40, 40, 40);
  doc.text("Phoenix Flow - Theme Audit Report", 14, 22);
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text(`Store: ${storeUrl}`, 14, 30);
  doc.text(`Generated: ${now}`, 14, 36);

  doc.setFontSize(14);
  doc.setTextColor(40, 40, 40);
  doc.text(`Overall Score: ${report.overall_score}/100`, 14, 48);

  // Category scores
  let y = 56;
  doc.setFontSize(10);
  Object.entries(report.category_scores).forEach(([cat, score]) => {
    doc.setTextColor(80, 80, 80);
    doc.text(`${cat.replace(/_/g, " ")}: ${score}/100`, 20, y);
    y += 6;
  });

  // Contrast checks table
  y += 6;
  doc.setFontSize(12);
  doc.setTextColor(40, 40, 40);
  doc.text("WCAG Contrast Checks", 14, y);
  doc.autoTable({
    startY: y + 4,
    head: [["Pair", "Ratio", "AA", "AAA"]],
    body: report.contrast_checks.map((c) => [c.pair, `${c.ratio}:1`, c.wcag_aa.toUpperCase(), c.wcag_aaa.toUpperCase()]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [80, 50, 120], textColor: 255 },
    didParseCell: (data: AutoTableCellContext) => {
      if ((data.column.index === 2 || data.column.index === 3) && data.section === "body") {
        const val = String(data.cell.raw).toLowerCase();
        if (val === "pass") data.cell.styles.textColor = [50, 180, 50];
        else if (val === "fail") data.cell.styles.textColor = [220, 50, 50];
      }
    },
  });

  // Findings table
  const findingsY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(12);
  doc.text("Findings", 14, findingsY);
  doc.autoTable({
    startY: findingsY + 4,
    head: [["Severity", "Category", "Finding", "Recommendation"]],
    body: report.findings.map((f) => [
      f.severity.toUpperCase(), f.category.replace(/_/g, " "),
      `${f.title}\n${f.description}`, f.recommendation,
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [80, 50, 120], textColor: 255 },
    columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 30 }, 2: { cellWidth: 70 }, 3: { cellWidth: 60 } },
    didParseCell: (data: AutoTableCellContext) => {
      if (data.column.index === 0 && data.section === "body") {
        const val = String(data.cell.raw).toLowerCase();
        if (val === "critical") data.cell.styles.textColor = [220, 50, 50];
        else if (val === "warning") data.cell.styles.textColor = [200, 150, 0];
        else if (val === "pass") data.cell.styles.textColor = [50, 180, 50];
      }
    },
  });

  downloadBlob(doc.output("blob"), `theme-audit-${storeUrl.replace(/[^a-zA-Z0-9]/g, "-")}.pdf`);
}

// ============================================================================
// LISTING SCANNER REPORTS
// ============================================================================

interface ListingFinding {
  type: string;
  severity: string;
  field: string;
  message: string;
  data?: unknown;
}

interface ListingResult {
  listing_id: number;
  title: string;
  image: string | null;
  findings: ListingFinding[];
}

interface ScanSummary {
  total_listings_scanned?: number;
  listings_with_issues?: number;
  warning_count?: number;
  critical_count?: number;
}

export function exportListingScanCsv(findings: ListingResult[], summary: ScanSummary | null) {
  const headers = ["Listing ID", "Title", "Severity", "Type", "Field", "Message"];
  const rows: string[][] = [];
  findings.forEach((listing) => {
    listing.findings.forEach((f) => {
      rows.push([String(listing.listing_id), listing.title, f.severity, f.type, f.field, f.message]);
    });
  });
  const csv = [headers.map(escapeCsv).join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\n");
  downloadFile(csv, `listing-scan-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv");
}

export function exportListingScanPdf(findings: ListingResult[], summary: ScanSummary | null) {
  const doc = new jsPDF();
  const now = new Date().toLocaleString();

  doc.setFontSize(20);
  doc.setTextColor(40, 40, 40);
  doc.text("Phoenix Flow - Listing Scan Report", 14, 22);
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text(`Generated: ${now}`, 14, 30);

  if (summary) {
    doc.text(`Listings Scanned: ${summary.total_listings_scanned || 0}`, 14, 38);
    doc.text(`With Issues: ${summary.listings_with_issues || 0}`, 14, 44);
    doc.text(`Critical: ${summary.critical_count || 0} | Warnings: ${summary.warning_count || 0}`, 14, 50);
  }

  const rows: string[][] = [];
  findings.forEach((listing) => {
    listing.findings
      .filter((f) => f.type !== "keyword_research")
      .forEach((f) => {
        rows.push([listing.title.slice(0, 40), f.severity.toUpperCase(), f.type.replace(/_/g, " "), f.message]);
      });
  });

  doc.autoTable({
    startY: summary ? 58 : 38,
    head: [["Listing", "Severity", "Type", "Issue"]],
    body: rows,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [80, 50, 120], textColor: 255 },
    columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 22 }, 2: { cellWidth: 30 }, 3: { cellWidth: 90 } },
    didParseCell: (data: AutoTableCellContext) => {
      if (data.column.index === 1 && data.section === "body") {
        const val = String(data.cell.raw).toLowerCase();
        if (val === "critical") data.cell.styles.textColor = [220, 50, 50];
        else if (val === "warning") data.cell.styles.textColor = [200, 150, 0];
      }
    },
  });

  downloadBlob(doc.output("blob"), `listing-scan-${new Date().toISOString().slice(0, 10)}.pdf`);
}
