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
  const now = new Date().toLocaleString();

  // Header
  doc.setFontSize(20);
  doc.setTextColor(40, 40, 40);
  doc.text("Phoenix Flow - Compliance Report", 14, 22);
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text(`Store: ${storeUrl}`, 14, 30);
  doc.text(`Generated: ${now}`, 14, 36);
  doc.text(`Pages Analyzed: ${report.pages_analyzed}`, 14, 42);

  // Score
  doc.setFontSize(14);
  doc.setTextColor(40, 40, 40);
  doc.text(`Compliance Score: ${report.score}/100`, 14, 54);
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  const summaryLines = doc.splitTextToSize(report.summary, 180);
  doc.text(summaryLines, 14, 62);

  const criticals = report.findings.filter((f) => f.severity === "critical").length;
  const warnings = report.findings.filter((f) => f.severity === "warning").length;
  const passed = report.findings.filter((f) => f.severity === "pass").length;
  doc.text(`Critical: ${criticals} | Warnings: ${warnings} | Passed: ${passed}`, 14, 62 + summaryLines.length * 5 + 4);

  // Findings table
  const startY = 62 + summaryLines.length * 5 + 14;
  doc.autoTable({
    startY,
    head: [["Severity", "Category", "Finding", "Recommendation"]],
    body: report.findings.map((f) => [
      f.severity.toUpperCase(),
      f.category.replace(/_/g, " "),
      `${f.title}\n${f.description}`,
      f.recommendation,
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [80, 50, 120], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 35 },
      2: { cellWidth: 70 },
      3: { cellWidth: 60 },
    },
    didParseCell: (data: AutoTableCellContext) => {
      if (data.column.index === 0 && data.section === "body") {
        const val = String(data.cell.raw).toLowerCase();
        if (val === "critical") data.cell.styles.textColor = [220, 50, 50];
        else if (val === "warning") data.cell.styles.textColor = [200, 150, 0];
        else if (val === "pass") data.cell.styles.textColor = [50, 180, 50];
      }
    },
  });

  downloadBlob(doc.output("blob"), `compliance-report-${storeUrl.replace(/[^a-zA-Z0-9]/g, "-")}.pdf`);
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
