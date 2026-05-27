import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToastAction } from "@/components/ui/toast";
import {
  Flower2, Sparkles, Store, Loader2, Tag, FileText, Palette,
  Image as ImageIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { isEtsyConnected } from "@/lib/etsyConnections";
import { isEtsyPlatform } from "@/lib/storePlatforms";

interface EtsyListing {
  listing_id: number;
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  taxonomy_path?: string;
  state: string;
  images?: { url_170x135?: string; url_570xN?: string }[];
}

interface EtsySuggestions {
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  reasoning: string;
}

interface StoreConnectionOption {
  id: string;
  platform: string;
  shop_domain: string | null;
  shop_name: string | null;
  scopes: string | null;
  created_at: string;
}

const ProductImage = ({ src, alt, size = "md" }: { src?: string; alt: string; size?: "sm" | "md" | "lg" }) => {
  const sizeClasses = { sm: "w-14 h-14", md: "w-20 h-20", lg: "w-32 h-32" };
  return src ? (
    <img src={src} alt={alt} className={`${sizeClasses[size]} rounded-lg object-cover border border-border/30`} />
  ) : (
    <div className={`${sizeClasses[size]} rounded-lg bg-muted/50 border border-border/30 flex items-center justify-center`}>
      <ImageIcon className="h-6 w-6 text-muted-foreground/50" />
    </div>
  );
};

const ComparisonRow = ({ label, icon, original, optimized, onChange, multiline }: {
  label: string; icon: React.ReactNode; original: string; optimized: string; onChange: (v: string) => void; multiline?: boolean;
}) => (
  <Card className="bg-card/50 border-border/30 overflow-hidden">
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium">{label}</span>
        {original !== optimized && <Badge className="bg-primary/10 text-primary text-xs border-0">Changed</Badge>}
      </div>
      {original && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-medium">Current</p>
          <p className="text-xs text-muted-foreground/60 leading-relaxed">{original}</p>
        </div>
      )}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-primary mb-1 font-medium">Optimized</p>
        <textarea
          className="w-full rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          value={optimized}
          rows={multiline ? Math.max(3, Math.ceil(optimized.length / 80)) : 2}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  </Card>
);

export default function EtsyOptimizer() {
  const { session } = useAuth();
  const { toast } = useToast();

  const [connections, setConnections] = useState<StoreConnectionOption[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [etsyOAuthStarting, setEtsyOAuthStarting] = useState(false);

  const [listings, setListings] = useState<EtsyListing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [selectedListing, setSelectedListing] = useState<EtsyListing | null>(null);
  const [suggestions, setSuggestions] = useState<EtsySuggestions | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [copying, setCopying] = useState(false);

  const loadConnections = async () => {
    const { data } = await supabase
      .from("store_connections")
      .select("id, platform, shop_domain, shop_name, scopes, created_at")
      .order("created_at", { ascending: false });
    const etsyRows = (data || []).filter((c) => isEtsyPlatform(c.platform) && isEtsyConnected(c));
    const eligibleRows = etsyRows.filter((c) => (c.scopes || "").trim() !== "public_read");

    setConnections(eligibleRows);
    setSelectedConnectionId((prev) => prev || (eligibleRows[0]?.id ?? ""));
  };

  useEffect(() => {
    if (!session) return;
    (async () => {
      setLoading(true);
      await loadConnections();
      setLoading(false);
    })();
  }, [session]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const etsyStatus = params.get("etsy");
    const etsyMessage = params.get("etsy_message");
    if (!etsyStatus) return;

    if (etsyStatus === "connected") {
      toast({ title: "Etsy connected", description: etsyMessage || "Your Etsy OAuth connection is active." });
      void loadConnections();
    } else {
      toast({
        title: etsyStatus === "denied" ? "Etsy authorization denied" : "Etsy connection failed",
        description: etsyMessage || "The Etsy OAuth flow did not complete.",
        variant: "destructive",
      });
    }

    params.delete("etsy");
    params.delete("etsy_message");
    const nextQuery = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);
  }, [toast]);

  useEffect(() => {
    if (!selectedConnectionId) return;
    if (listingsLoading) return;
    if (selectedListing) return;
    if (listings.length > 0) return;
    void fetchListings(selectedConnectionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConnectionId]);

  const selectedConnection = connections.find((c) => c.id === selectedConnectionId) ?? null;

  const fetchListings = async (connectionId?: string) => {
    const id = connectionId ?? selectedConnectionId;
    if (!id) return;
    setListingsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-etsy-listings", {
        body: { limit: 10, state: "active", connectionId: id },
      });
      if (error) throw error;
      setListings(data.results || []);
    } catch (err: unknown) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setListingsLoading(false);
    }
  };

  const startEtsyOAuth = async () => {
    setEtsyOAuthStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke("etsy-auth", {
        body: { returnPath: "/etsy-optimizer", appOrigin: window.location.origin },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("Etsy authorization URL was not returned");
      window.location.href = data.url;
    } catch (err: unknown) {
      toast({ title: "Connection failed", description: (err as Error).message, variant: "destructive" });
      setEtsyOAuthStarting(false);
    }
  };

  const optimizeListing = async (listing: EtsyListing) => {
    setSelectedListing(listing);
    setSuggestions(null);
    setOptimizing(true);
    try {
      const { data, error } = await supabase.functions.invoke("optimize-etsy-listing", { body: { listing } });
      if (error) throw error;
      setSuggestions(data.suggestions);
    } catch (err: unknown) {
      toast({ title: "Optimization failed", description: (err as Error).message, variant: "destructive" });
      setSelectedListing(null);
    } finally {
      setOptimizing(false);
    }
  };

  const applyChanges = async () => {
    if (!selectedListing || !suggestions) return;
    setApplying(true);
    try {
      const { error } = await supabase.functions.invoke("apply-etsy-changes", {
        body: {
          listingId: selectedListing.listing_id,
          originalData: {
            title: selectedListing.title,
            description: selectedListing.description,
            tags: selectedListing.tags,
            materials: selectedListing.materials,
          },
          optimizedData: suggestions,
          connectionId: selectedConnectionId,
        },
      });
      if (error) throw error;
      toast({ title: "Done!", description: "Changes applied to your Etsy shop." });
      setSelectedListing(null);
      setSuggestions(null);
      void fetchListings();
    } catch (err: unknown) {
      const message = (err as Error).message;
      const needsReconnect = /reconnect|token expired|unauthorized/i.test(message);
      toast({
        title: "Apply failed",
        description: message,
        variant: "destructive",
        action: needsReconnect ? (
          <ToastAction altText="Reconnect with Etsy" onClick={() => void startEtsyOAuth()}>
            Reconnect
          </ToastAction>
        ) : undefined,
      });
    } finally {
      setApplying(false);
    }
  };

  const copyOptimized = async () => {
    if (!suggestions) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(
        [
          `Title: ${suggestions.title}`,
          "",
          "Description:",
          suggestions.description,
          "",
          `Tags: ${suggestions.tags.join(", ")}`,
          `Materials: ${suggestions.materials.join(", ")}`,
        ].join("\n"),
      );
      toast({ title: "Copied", description: "Optimized fields copied to clipboard." });
    } catch (err: unknown) {
      toast({ title: "Copy failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setCopying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Flower2 className="h-6 w-6 text-primary" /> Listing Optimizer
        </h1>
        <p className="text-muted-foreground mt-1">Pick a listing → AI optimizes title, description, tags, and materials → Apply directly to Etsy.</p>
      </motion.div>

      {connections.length === 0 ? (
        <Card className="bg-card/50 border-border/30">
          <CardContent className="p-8 text-center space-y-4">
            <Store className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="text-lg font-semibold">Connect Your Etsy Shop</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Connect via Etsy OAuth so Phoenix Flow can fetch listings and apply changes directly to Etsy.
            </p>
            <div className="space-y-3 max-w-md mx-auto">
              <Button
                onClick={() => void startEtsyOAuth()}
                disabled={etsyOAuthStarting}
                className="gradient-phoenix text-primary-foreground w-full"
              >
                {etsyOAuthStarting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Connect with Etsy (OAuth)
              </Button>
              <Button
                variant="ghost"
                onClick={() => { window.location.href = "/settings"; }}
                className="w-full"
              >
                Go to Settings
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="bg-card/50 border-border/30">
            <CardContent className="p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Active Etsy shop</p>
                <p className="text-xs text-muted-foreground">Select the shop to optimize.</p>
              </div>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={selectedConnectionId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedConnectionId(id);
                  setSelectedListing(null);
                  setListings([]);
                  if (id) void fetchListings(id);
                }}
              >
                <option value="">Select an Etsy shop</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shop_name || c.shop_domain || "Etsy shop"}
                  </option>
                ))}
              </select>
            </CardContent>
          </Card>

          {listingsLoading ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading listings...</p>
            </div>
          ) : selectedListing ? (
            <AnimatePresence mode="wait">
              <motion.div key="etsy-detail" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                <Card className="bg-card/50 border-border/30">
                  <CardContent className="p-4 flex gap-4">
                    <ProductImage src={selectedListing.images?.[0]?.url_570xN} alt={selectedListing.title} size="lg" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="font-semibold text-base leading-tight">{selectedListing.title}</h2>
                        <Button variant="ghost" size="sm" onClick={() => { setSelectedListing(null); setSuggestions(null); }}>Back</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {optimizing ? (
                  <Card className="bg-card/50 border-border/30 p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Optimizing for Etsy search...</p>
                  </Card>
                ) : suggestions ? (
                  <>
                    <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
                      <Sparkles className="h-4 w-4 inline mr-1 text-primary" />{suggestions.reasoning}
                    </div>
                    <ComparisonRow label="Title" icon={<Tag className="h-4 w-4 text-primary" />} original={selectedListing.title} optimized={suggestions.title} onChange={(v) => setSuggestions({ ...suggestions, title: v })} />
                    <ComparisonRow label="Description" icon={<FileText className="h-4 w-4 text-primary" />} original={selectedListing.description || ""} optimized={suggestions.description} onChange={(v) => setSuggestions({ ...suggestions, description: v })} multiline />
                    <ComparisonRow label="Tags" icon={<Tag className="h-4 w-4 text-primary" />} original={selectedListing.tags?.join(", ") || ""} optimized={suggestions.tags?.join(", ") || ""} onChange={(v) => setSuggestions({ ...suggestions, tags: v.split(",").map((t) => t.trim()) })} multiline />
                    <ComparisonRow label="Materials" icon={<Palette className="h-4 w-4 text-primary" />} original={selectedListing.materials?.join(", ") || ""} optimized={suggestions.materials?.join(", ") || ""} onChange={(v) => setSuggestions({ ...suggestions, materials: v.split(",").map((t) => t.trim()) })} multiline />
                    <div className="flex gap-3 pt-2">
                      <Button onClick={applyChanges} disabled={applying || !selectedConnection} className="gradient-phoenix text-primary-foreground flex-1">
                        {applying ? "Applying..." : "Apply to Etsy"}
                      </Button>
                      <Button variant="outline" onClick={() => void copyOptimized()} disabled={copying} className="flex-1">
                        {copying ? "Copying..." : "Copy optimized fields"}
                      </Button>
                    </div>
                  </>
                ) : null}
              </motion.div>
            </AnimatePresence>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {selectedConnectionId ? `${listings.length} listings` : "Select a shop above to load listings."}
                </p>
                <Button variant="outline" size="sm" onClick={() => void fetchListings()} disabled={!selectedConnectionId}>
                  Refresh
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {listings.map((listing) => (
                  <motion.div key={listing.listing_id} whileHover={{ scale: 1.01 }} className="cursor-pointer" onClick={() => void optimizeListing(listing)}>
                    <Card className="bg-card/50 border-border/30 hover:border-primary/40">
                      <CardContent className="p-3 flex gap-3">
                        <ProductImage src={listing.images?.[0]?.url_170x135} alt={listing.title} size="md" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm line-clamp-2">{listing.title}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
