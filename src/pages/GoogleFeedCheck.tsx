import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  ShoppingCart, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, Loader2, RefreshCw, Check,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface VariantIssue {
  variantId: number;
  variantTitle: string;
  sku: string;
  issue: string;
  severity: "critical" | "warning";
  fixable: boolean;
  currentValue: string | null;
}

interface ProductResult {
  productId: number;
  title: string;
  productType: string;
  status: string;
  image: string | null;
  colorOptionIndex: number | null;
  colorOptionName: string | null;
  issues: VariantIssue[];
  passCount: number;
  failCount: number;
  overallStatus: "pass" | "warning" | "fail";
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

interface StoreOption {
  id: string;
  shop_domain: string | null;
  shop_name: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ProductResult["overallStatus"] }) {
  if (status === "pass") return (
    <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 gap-1">
      <CheckCircle2 className="w-3 h-3" /> Pass
    </Badge>
  );
  if (status === "warning") return (
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

// ─── Inline color fix ───────────────────────────────────────────────────────

function ColorFixRow({
  connectionId, productId, colorOptionIndex, issue, onFixed,
}: {
  connectionId: string;
  productId: number;
  colorOptionIndex: number;
  issue: VariantIssue;
  onFixed: (productId: number, variantId: number) => void;
}) {
  const { toast } = useToast();
  // Start blank rather than pre-filled with the vague/empty value being replaced —
  // that value is exactly what's wrong, so re-saving it by accident should take a
  // deliberate retype, not an easy no-op Enter press.
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!value.trim()) {
      toast({ title: "Enter a color first", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("fix-google-feed-color", {
        body: { connectionId, variantId: issue.variantId, colorOptionIndex, color: value.trim() },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Save failed");
      toast({ title: "Color saved", description: `${issue.variantTitle} → ${value.trim()}` });
      onFixed(productId, issue.variantId);
    } catch (err) {
      toast({
        title: "Couldn't save",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. Navy"
        className="h-7 text-xs w-28"
        disabled={saving}
        onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
      />
      <Button size="sm" variant="outline" className="h-7 px-2" disabled={saving} onClick={() => void save()}>
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
      </Button>
    </div>
  );
}

// ─── Product row ──────────────────────────────────────────────────────────────

function ProductRow({
  product, connectionId, onFixed,
}: {
  product: ProductResult;
  connectionId: string;
  onFixed: (productId: number, variantId: number) => void;
}) {
  const [open, setOpen] = useState(product.overallStatus !== "pass");
  const hasDetails = product.issues.length > 0;
  const variantIssues = product.issues.filter((i) => i.variantId !== 0);
  const productIssues = product.issues.filter((i) => i.variantId === 0);

  return (
    <div className="border border-border/40 rounded-lg overflow-hidden">
      <button
        onClick={() => hasDetails && setOpen(v => !v)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
          ${hasDetails ? "hover:bg-muted/40 cursor-pointer" : "cursor-default"}
          ${product.overallStatus === "fail" ? "bg-red-500/5" : product.overallStatus === "warning" ? "bg-yellow-500/5" : "bg-green-500/5"}`}>
        {hasDetails ? (
          open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
               : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : <span className="w-4 h-4 shrink-0" />}
        <span className="flex-1 font-medium text-sm truncate">{product.title}</span>
        {variantIssues.length > 0 && (
          <span className="text-xs text-muted-foreground mr-2">
            {variantIssues.length} variant{variantIssues.length !== 1 ? "s" : ""} flagged
          </span>
        )}
        <StatusBadge status={product.overallStatus} />
      </button>

      {open && hasDetails && (
        <div className="border-t border-border/40 px-4 py-3 space-y-3 bg-card">
          {/* Product-level issues */}
          {productIssues.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Product Issues</p>
              {productIssues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                  <span className="text-foreground/80">{issue.issue}</span>
                </div>
              ))}
            </div>
          )}

          {/* Variant-level issues */}
          {variantIssues.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Variant Issues</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground text-left border-b border-border/30">
                      <th className="pb-1.5 pr-4 font-medium">Variant</th>
                      <th className="pb-1.5 pr-4 font-medium">SKU</th>
                      <th className="pb-1.5 pr-4 font-medium">Issue</th>
                      {product.colorOptionIndex !== null && <th className="pb-1.5 font-medium">Fix</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {variantIssues.map((vi) => (
                      <tr key={vi.variantId} className="border-b border-border/20 last:border-0">
                        <td className="py-1.5 pr-4 font-medium align-top">{vi.variantTitle}</td>
                        <td className="py-1.5 pr-4 text-muted-foreground align-top">{vi.sku || "—"}</td>
                        <td className="py-1.5 pr-4 align-top">
                          <div className="flex items-start gap-1.5">
                            <SeverityIcon severity={vi.severity} />
                            <span className="text-foreground/80">{vi.issue}</span>
                          </div>
                        </td>
                        {product.colorOptionIndex !== null && (
                          <td className="py-1.5 align-top">
                            {vi.fixable ? (
                              <ColorFixRow
                                connectionId={connectionId}
                                productId={product.productId}
                                colorOptionIndex={product.colorOptionIndex}
                                issue={vi}
                                onFixed={onFixed}
                              />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        )}
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
  const { user } = useAuth();
  const { toast } = useToast();
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FeedCheckResult | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: rows } = await supabase
        .from("store_connections")
        .select("id, shop_domain, shop_name")
        .eq("user_id", user.id)
        .eq("platform", "shopify")
        .order("created_at", { ascending: false });
      const list = rows || [];
      setStores(list);
      if (list.length === 1) setConnectionId(list[0].id);
    })();
  }, [user]);

  const runCheck = async () => {
    if (!connectionId) {
      toast({ title: "Pick a store first", variant: "destructive" });
      return;
    }
    setLoading(true);
    setData(null);
    try {
      const { data: result, error } = await supabase.functions.invoke("check-google-feed", {
        body: { connectionId },
      });
      if (error) throw new Error(error.message);
      if (result?.error) throw new Error(result.error);
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

  // Optimistically drop a fixed variant's issue from local state so the row updates
  // without needing a full re-scan.
  const handleFixed = (productId: number, variantId: number) => {
    setData((prev) => {
      if (!prev) return prev;
      const results = prev.results.map((p) => {
        if (p.productId !== productId) return p;
        const issues = p.issues.filter((i) => i.variantId !== variantId);
        const criticalCount = issues.filter((i) => i.severity === "critical").length;
        const warningCount = issues.filter((i) => i.severity === "warning").length;
        const overallStatus: ProductResult["overallStatus"] =
          criticalCount > 0 ? "fail" : warningCount > 0 ? "warning" : "pass";
        return { ...p, issues, overallStatus };
      });
      const summary = {
        total: results.length,
        pass: results.filter((r) => r.overallStatus === "pass").length,
        warn: results.filter((r) => r.overallStatus === "warning").length,
        fail: results.filter((r) => r.overallStatus === "fail").length,
      };
      return { results, summary };
    });
  };

  const filtered = data?.results.filter(p => {
    if (filter === "all") return true;
    if (filter === "fail") return p.overallStatus === "fail";
    if (filter === "warn") return p.overallStatus === "warning";
    return p.overallStatus === "pass";
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
        <p>Every variant needs a <strong>Color</strong> attribute (named exactly that, not "Colour"). The value must be specific — "Blue" not "Default" or blank. Color mentioned in the product title or description doesn't count — Google only reads the structured Color option on each variant. If only one size has a color set (e.g. only Small has "Navy" while Medium–XL are blank), Google flags the whole product.</p>
      </div>

      {/* Store picker + run button */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={connectionId} onValueChange={setConnectionId}>
          <SelectTrigger className="w-64 bg-background/50">
            <SelectValue placeholder={stores.length ? "Pick a connected Shopify store" : "No Shopify store connected"} />
          </SelectTrigger>
          <SelectContent>
            {stores.map((store) => (
              <SelectItem key={store.id} value={store.id}>
                {store.shop_name || store.shop_domain || store.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={runCheck} disabled={loading || !connectionId} className="gap-2">
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
              {filtered.map(p => (
                <ProductRow key={p.productId} product={p} connectionId={connectionId} onFixed={handleFixed} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!data && !loading && (
        <div className="text-center py-16 text-muted-foreground text-sm border border-dashed border-border/40 rounded-xl">
          <ShoppingCart className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p>Pick a store, then click <strong>Run Feed Scan</strong> to check your products.</p>
          <p className="mt-1 text-xs opacity-70">Reads product + variant data directly from Shopify. Nothing is changed unless you use a "Fix" field above.</p>
        </div>
      )}
    </div>
  );
}
