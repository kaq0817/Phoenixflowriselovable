import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  ShoppingCart, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, Loader2, RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface VariantIssue {
  variantId: number;
  variantTitle: string;
  sku: string;
  issue: string;
  severity: "critical" | "warning";
}

interface ProductResult {
  productId: number;
  title: string;
  status: "pass" | "warn" | "fail";
  issues: string[];
  variantIssues: VariantIssue[];
}

interface FeedSummary {
  total: number;
  pass: number;
  warn: number;
  fail: number;
}

interface FeedCheckResult {
  results: ProductResult[];
  summary: FeedSummary;
}

type Filter = "all" | "fail" | "warn" | "pass";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ProductResult["status"] }) {
  if (status === "pass") return (
    <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 gap-1">
      <CheckCircle2 className="w-3 h-3" /> Pass
    </Badge>
  );
  if (status === "warn") return (
    <Badge className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20 gap-1">
      <AlertTriangle className="w-3 h-3" /> Warning
    </Badge>
  );
  return (
    <Badge className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20 gap-1">
      <XCircle className="w-3 h-3" /> Critical
    </Badge>
  );
}

function SeverityIcon({ severity }: { severity: VariantIssue["severity"] }) {
  if (severity === "critical") return <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />;
  return <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 shrink-0 mt-0.5" />;
}

// ─── Product row ──────────────────────────────────────────────────────────────

function ProductRow({ product }: { product: ProductResult }) {
  const [open, setOpen] = useState(product.status !== "pass");
  const hasDetails = product.issues.length > 0 || product.variantIssues.length > 0;

  return (
    <div className="border border-border/40 rounded-lg overflow-hidden">
      <button
        onClick={() => hasDetails && setOpen(v => !v)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
          ${hasDetails ? "hover:bg-muted/40 cursor-pointer" : "cursor-default"}
          ${product.status === "fail" ? "bg-red-500/5" : product.status === "warn" ? "bg-yellow-500/5" : "bg-green-500/5"}`}>
        {hasDetails ? (
          open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
               : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : <span className="w-4 h-4 shrink-0" />}
        <span className="flex-1 font-medium text-sm truncate">{product.title}</span>
        {product.variantIssues.length > 0 && (
          <span className="text-xs text-muted-foreground mr-2">
            {product.variantIssues.length} variant{product.variantIssues.length !== 1 ? "s" : ""} flagged
          </span>
        )}
        <StatusBadge status={product.status} />
      </button>

      {open && hasDetails && (
        <div className="border-t border-border/40 px-4 py-3 space-y-3 bg-card">
          {/* Product-level issues */}
          {product.issues.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Product Issues</p>
              {product.issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                  <span className="text-foreground/80">{issue}</span>
                </div>
              ))}
            </div>
          )}

          {/* Variant-level issues */}
          {product.variantIssues.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Variant Issues</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground text-left border-b border-border/30">
                      <th className="pb-1.5 pr-4 font-medium">Variant</th>
                      <th className="pb-1.5 pr-4 font-medium">SKU</th>
                      <th className="pb-1.5 font-medium">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.variantIssues.map((vi) => (
                      <tr key={vi.variantId} className="border-b border-border/20 last:border-0">
                        <td className="py-1.5 pr-4 font-medium">{vi.variantTitle}</td>
                        <td className="py-1.5 pr-4 text-muted-foreground">{vi.sku || "—"}</td>
                        <td className="py-1.5">
                          <div className="flex items-start gap-1.5">
                            <SeverityIcon severity={vi.severity} />
                            <span className="text-foreground/80">{vi.issue}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function GoogleFeedCheck() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FeedCheckResult | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const runCheck = async () => {
    setLoading(true);
    setData(null);
    try {
      const { data: result, error } = await supabase.functions.invoke("check-google-feed", {
        body: {},
      });
      if (error) throw new Error(error.message);
      setData(result as FeedCheckResult);
      toast({ title: "Scan complete", description: `${result.summary.total} products checked.` });
    } catch (err) {
      toast({
        title: "Scan failed",
        description: err instanceof Error ? err.message : "Check your Shopify connection and try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filtered = data?.results.filter(p => {
    if (filter === "all") return true;
    if (filter === "fail") return p.status === "fail";
    if (filter === "warn") return p.status === "warn";
    return p.status === "pass";
  }) ?? [];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <ShoppingCart className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold">Google Feed Checker</h1>
          <Badge className="bg-primary/10 text-primary border-0 text-xs">Shopify</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Scans every product and variant in your Shopify store for missing or vague color values — the #1 reason Google Shopping rejects listings.
          All product types are checked, not just apparel.
        </p>
      </div>

      {/* Info box */}
      <div className="bg-yellow-500/8 border border-yellow-500/20 rounded-lg px-4 py-3 text-sm text-foreground/80 space-y-1">
        <p className="font-semibold text-yellow-700 dark:text-yellow-400 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4" /> What Google requires
        </p>
        <p>Every variant needs a <strong>Color</strong> attribute (named exactly that, not "Colour"). The value must be specific — "Blue" not "Default" or blank. If only one size has a color set (e.g. only Small has "Navy" while Medium–XL are blank), Google flags the whole product.</p>
      </div>

      {/* Run button */}
      <div className="flex items-center gap-3">
        <Button onClick={runCheck} disabled={loading} className="gap-2">
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning…</>
            : <><RefreshCw className="w-4 h-4" /> Run Feed Scan</>}
        </Button>
        {data && (
          <span className="text-sm text-muted-foreground">
            Last scan: {data.summary.total} products
          </span>
        )}
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total",    value: data.summary.total, color: "text-foreground",                            bg: "bg-card" },
            { label: "Pass",     value: data.summary.pass,  color: "text-green-700 dark:text-green-400",         bg: "bg-green-500/8" },
            { label: "Warning",  value: data.summary.warn,  color: "text-yellow-700 dark:text-yellow-400",       bg: "bg-yellow-500/8" },
            { label: "Critical", value: data.summary.fail,  color: "text-red-700 dark:text-red-400",             bg: "bg-red-500/8" },
          ].map(s => (
            <div key={s.label} className={`${s.bg} border border-border/40 rounded-lg p-4 text-center`}>
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter + results */}
      {data && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-1">Filter</p>
            {(["all", "fail", "warn", "pass"] as Filter[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-all
                  ${filter === f
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border/40 text-muted-foreground hover:border-border"}`}>
                {f === "all" ? "All" : f === "fail" ? "Critical" : f === "warn" ? "Warning" : "Pass"}
                <span className="ml-1 opacity-70">
                  ({f === "all" ? data.summary.total
                    : f === "fail" ? data.summary.fail
                    : f === "warn" ? data.summary.warn
                    : data.summary.pass})
                </span>
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              No products match this filter.
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(p => <ProductRow key={p.productId} product={p} />)}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!data && !loading && (
        <div className="text-center py-16 text-muted-foreground text-sm border border-dashed border-border/40 rounded-xl">
          <ShoppingCart className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p>Click <strong>Run Feed Scan</strong> to check your products.</p>
          <p className="mt-1 text-xs opacity-70">Reads product + variant data directly from Shopify — no changes are made.</p>
        </div>
      )}
    </div>
  );
}
