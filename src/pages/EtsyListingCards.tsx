import { useState, useRef, useCallback } from "react";
import { toPng } from "html-to-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Download, Sparkles, Loader2, Star, Shield,
  CheckCircle, Truck, Layers, ChevronRight, Palette,
  ImagePlus, X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type CardType = "features" | "social" | "promise" | "shipping" | "variations";
type ThemePreset = "warm" | "rose" | "sage" | "ocean" | "dark" | "iron" | "void";
type Niche = "wellness" | "gaming";

interface Theme {
  name: string;
  bg: string;           // solid fallback
  grad: string;         // main bg gradient
  floral: string;       // floral overlay tint
  text: string;
  accent: string;
  subtext: string;
  divider: string;
  photoBorder: string;
  tagBg: string;
  tagText: string;
}

// ─── Themes ───────────────────────────────────────────────────────────────────

const THEMES: Record<ThemePreset, Theme> = {
  warm: {
    name: "Warm Bloom",
    bg: "#f9e4c0",
    grad: "linear-gradient(135deg,#fdf1dc 0%,#f9e0b0 40%,#f2cc88 100%)",
    floral: "rgba(220,160,60,0.13)",
    text: "#3a2410",
    accent: "#b8581a",
    subtext: "#7a4a28",
    divider: "#ddb060",
    photoBorder: "rgba(180,110,30,0.25)",
    tagBg: "rgba(180,88,26,0.12)",
    tagText: "#9a3c0a",
  },
  rose: {
    name: "Rose Garden",
    bg: "#fce8e8",
    grad: "linear-gradient(135deg,#fdf0f0 0%,#f8d8d8 40%,#f0b8b8 100%)",
    floral: "rgba(200,80,80,0.10)",
    text: "#3a1010",
    accent: "#b83030",
    subtext: "#7a3030",
    divider: "#e09090",
    photoBorder: "rgba(180,60,60,0.22)",
    tagBg: "rgba(180,48,48,0.10)",
    tagText: "#9a2020",
  },
  sage: {
    name: "Sage Garden",
    bg: "#e8f0e0",
    grad: "linear-gradient(135deg,#f0f6ea 0%,#daecd0 40%,#bfd9b2 100%)",
    floral: "rgba(70,120,70,0.10)",
    text: "#1a3020",
    accent: "#3a7048",
    subtext: "#4a6852",
    divider: "#90c098",
    photoBorder: "rgba(58,112,72,0.22)",
    tagBg: "rgba(58,112,72,0.10)",
    tagText: "#2a5835",
  },
  ocean: {
    name: "Ocean Calm",
    bg: "#deeaf8",
    grad: "linear-gradient(135deg,#eef5fd 0%,#d4e8f8 40%,#b0d0f0 100%)",
    floral: "rgba(40,90,170,0.10)",
    text: "#0f2040",
    accent: "#1a5090",
    subtext: "#304870",
    divider: "#80aad8",
    photoBorder: "rgba(26,80,144,0.20)",
    tagBg: "rgba(26,80,144,0.10)",
    tagText: "#103878",
  },
  dark: {
    name: "Midnight",
    bg: "#1a0e00",
    grad: "linear-gradient(135deg,#1e1000 0%,#2d1800 40%,#3d2000 100%)",
    floral: "rgba(210,140,50,0.12)",
    text: "#f5dfc0",
    accent: "#d08030",
    subtext: "#b09060",
    divider: "#5a3010",
    photoBorder: "rgba(210,140,50,0.30)",
    tagBg: "rgba(210,140,50,0.15)",
    tagText: "#e0a050",
  },
  iron: {
    name: "Iron Phoenix",
    bg: "#1c1c24",
    grad: "linear-gradient(135deg,#1a1a22 0%,#242430 40%,#2e2e3e 100%)",
    floral: "rgba(255,100,30,0.10)",
    text: "#f0eae0",
    accent: "#ff6820",
    subtext: "#c0b8a8",
    divider: "#3a3050",
    photoBorder: "rgba(255,104,32,0.35)",
    tagBg: "rgba(255,104,32,0.14)",
    tagText: "#ff8040",
  },
  void: {
    name: "Void Protocol",
    bg: "#080c14",
    grad: "linear-gradient(135deg,#060a12 0%,#0d1424 40%,#121e34 100%)",
    floral: "rgba(60,140,255,0.10)",
    text: "#d0e8ff",
    accent: "#3c8cff",
    subtext: "#8aaed8",
    divider: "#1a2e50",
    photoBorder: "rgba(60,140,255,0.35)",
    tagBg: "rgba(60,140,255,0.13)",
    tagText: "#60aaff",
  },
};

// ─── Niche theme groupings ────────────────────────────────────────────────────

const NICHE_THEMES: Record<Niche, { label: string; themes: ThemePreset[] }> = {
  wellness: { label: "Wellness / Etsy", themes: ["warm", "rose", "sage", "ocean"] },
  gaming:   { label: "Gaming / Work",   themes: ["dark", "iron", "void"] },
};

// ─── Card type metadata ────────────────────────────────────────────────────────

const CARD_META: Record<CardType, { label: string; icon: React.ReactNode; hint: string }> = {
  features:   { label: "Made With Care",  icon: <CheckCircle className="w-4 h-4" />, hint: "Features & quality bullets" },
  social:     { label: "Customer Love",   icon: <Star className="w-4 h-4" />,        hint: "Stars & review quote" },
  promise:    { label: "Our Promise",     icon: <Shield className="w-4 h-4" />,      hint: "Guarantee & satisfaction" },
  shipping:   { label: "Shipping Info",   icon: <Truck className="w-4 h-4" />,       hint: "Production & delivery times" },
  variations: { label: "Design Options",  icon: <Layers className="w-4 h-4" />,      hint: "A / B / C / D variations" },
};

// ─── Default content ───────────────────────────────────────────────────────────

const DEFAULTS: Record<CardType, Record<string, string>> = {
  features: {
    heading: "Made With Care",
    b1: "Free Gift Box",
    b2: "Fast Shipping",
    b3: "Personalized Design",
    b4: "Premium Print Quality",
    b5: "Circle & Heart Shapes",
  },
  social: {
    heading: "Customer Love",
    stars: "5",
    quote: "Beautiful quality and the perfect keepsake for our family. It came so carefully packaged and made a lovely gift.",
    reviewer: "",
  },
  promise: {
    heading: "Our Promise To You",
    body: "We are 100% committed to making you happy. If for any reason you are not happy with your order, just let us know and we'll make it right.",
    sub: "Your satisfaction is our priority — always.",
  },
  shipping: {
    heading: "When Will It Arrive?",
    production: "2–3",
    transit: "3–7",
    note: "Custom & personalized items are made to order just for you.",
    holiday: "After Nov 15 we will do our best to get your order to you quickly, but holiday delays may occur.",
  },
  variations: {
    heading: "Design Variations",
    varA: "Classic Round",
    varB: "Heart Shape",
    varC: "Rectangle",
    varD: "Custom Size",
    note: "See all photos for design details",
  },
};

// ─── Card size ─────────────────────────────────────────────────────────────────
// Preview renders at 540px wide × 420px tall (landscape, like the slide)
// Exported at 3× = 1620×1260 (wide landscape Etsy listing image)
const W = 540;
const H = 420;

// ─── Shared card shell ─────────────────────────────────────────────────────────

function CardShell({
  theme, photo, children,
}: {
  theme: Theme;
  photo: string | null;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      width: W, height: H,
      background: theme.grad,
      display: "flex",
      fontFamily: "'Georgia','Times New Roman',serif",
      position: "relative",
      overflow: "hidden",
      boxSizing: "border-box",
    }}>
      {/* Floral texture overlay — SVG-based scattered circles mimicking botanical spots */}
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
      >
        {/* Scattered petal/dot shapes for a floral feel */}
        {[
          [18,18,9],[55,70,6],[40,130,5],[20,200,8],[60,290,4],[30,360,7],[15,H-30,5],
          [W-20,25,8],[W-50,80,5],[W-35,160,7],[W-25,240,4],[W-55,310,6],[W-20,H-40,8],
          [W/2-60,10,5],[W/2+40,H-15,6],[90,H-20,4],[W-90,H-25,5],
        ].map(([cx, cy, r], i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={r} ry={r * 0.65}
            fill={theme.floral} transform={`rotate(${i * 37} ${cx} ${cy})`} />
        ))}
        {/* larger soft blobs at corners */}
        <ellipse cx={0} cy={0} rx={80} ry={60} fill={theme.floral} opacity={0.7} />
        <ellipse cx={W} cy={H} rx={80} ry={60} fill={theme.floral} opacity={0.5} />
        <ellipse cx={W} cy={0} rx={50} ry={40} fill={theme.floral} opacity={0.4} />
        <ellipse cx={0} cy={H} rx={50} ry={40} fill={theme.floral} opacity={0.4} />
      </svg>

      {/* Content layer */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", width: "100%", height: "100%" }}>
        {/* Left text column */}
        <div style={{
          flex: "0 0 58%",
          padding: "28px 24px 24px 30px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}>
          {children}
        </div>

        {/* Right photo column */}
        <div style={{
          flex: "0 0 42%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px 20px 20px 0",
        }}>
          {photo ? (
            <div style={{
              width: "170px",
              height: "170px",
              borderRadius: "12px",
              overflow: "hidden",
              border: `3px solid ${theme.photoBorder}`,
              boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
            }}>
              <img src={photo} alt="product" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          ) : (
            <div style={{
              width: "170px", height: "170px",
              borderRadius: "12px",
              border: `2px dashed ${theme.divider}`,
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              color: theme.subtext,
              fontSize: "12px", textAlign: "center",
              gap: "6px",
            }}>
              <span style={{ fontSize: "28px", opacity: 0.5 }}>📷</span>
              <span style={{ opacity: 0.6, lineHeight: 1.3 }}>Upload product photo</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Shared heading / divider ──────────────────────────────────────────────────

function Hdg({ theme, text }: { theme: Theme; text: string }) {
  return (
    <div style={{
      fontSize: "22px", fontWeight: 700, color: theme.text,
      lineHeight: 1.15, marginBottom: "6px",
      fontFamily: "'Georgia','Times New Roman',serif",
    }}>
      {text}
    </div>
  );
}

function Rule({ theme }: { theme: Theme }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", margin: "8px 0" }}>
      <div style={{ flex: 1, height: "1px", background: theme.divider }} />
      <span style={{ color: theme.accent, fontSize: "11px" }}>♡</span>
      <div style={{ flex: 1, height: "1px", background: theme.divider }} />
    </div>
  );
}

function Tag({ theme, text }: { theme: Theme; text: string }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: "6px",
      background: theme.tagBg,
      borderRadius: "20px",
      padding: "4px 10px",
      marginBottom: "6px",
    }}>
      <span style={{
        width: "14px", height: "14px", borderRadius: "50%",
        background: theme.accent, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ color: "#fff", fontSize: "8px", fontWeight: 700 }}>✓</span>
      </span>
      <span style={{ fontSize: "12px", color: theme.tagText, fontWeight: 600 }}>{text}</span>
    </div>
  );
}

// ─── Card renderers ────────────────────────────────────────────────────────────

function FeaturesCard({ theme, content, photo }: { theme: Theme; content: Record<string, string>; photo: string | null }) {
  const bullets = ["b1","b2","b3","b4","b5"].map(k => content[k]).filter(Boolean);
  return (
    <CardShell theme={theme} photo={photo}>
      <Hdg theme={theme} text={content.heading || "Made With Care"} />
      <Rule theme={theme} />
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {bullets.map((b, i) => <Tag key={i} theme={theme} text={b} />)}
      </div>
    </CardShell>
  );
}

function SocialCard({ theme, content, photo }: { theme: Theme; content: Record<string, string>; photo: string | null }) {
  const stars = Math.min(5, Math.max(1, parseInt(content.stars || "5", 10)));
  return (
    <CardShell theme={theme} photo={photo}>
      <Hdg theme={theme} text={content.heading || "Customer Love"} />
      <Rule theme={theme} />
      <div style={{ marginBottom: "10px" }}>
        {Array.from({ length: stars }).map((_, i) => (
          <span key={i} style={{ color: "#e8a020", fontSize: "18px" }}>★</span>
        ))}
      </div>
      <p style={{
        fontSize: "12.5px", color: theme.text, lineHeight: 1.6,
        fontStyle: "italic", margin: 0,
      }}>"{content.quote}"</p>
      {content.reviewer && (
        <p style={{ fontSize: "11px", color: theme.subtext, marginTop: "8px", fontWeight: 600 }}>
          — {content.reviewer}
        </p>
      )}
    </CardShell>
  );
}

function PromiseCard({ theme, content, photo }: { theme: Theme; content: Record<string, string>; photo: string | null }) {
  return (
    <CardShell theme={theme} photo={photo}>
      <Hdg theme={theme} text={content.heading || "Our Promise To You"} />
      <Rule theme={theme} />
      <p style={{
        fontSize: "12.5px", color: theme.text, lineHeight: 1.65,
        margin: "0 0 12px 0",
      }}>
        {content.body}
      </p>
      {content.sub && (
        <p style={{ fontSize: "11.5px", color: theme.accent, fontWeight: 700, margin: 0 }}>
          {content.sub}
        </p>
      )}
    </CardShell>
  );
}

function ShippingCard({ theme, content, photo }: { theme: Theme; content: Record<string, string>; photo: string | null }) {
  return (
    <CardShell theme={theme} photo={photo}>
      <Hdg theme={theme} text={content.heading || "When Will It Arrive?"} />
      <Rule theme={theme} />
      <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
        {[
          { emoji: "🛠️", label: "PRODUCTION", val: `${content.production || "2–3"} days` },
          { emoji: "📦", label: "TRANSIT",    val: `${content.transit || "3–7"} days` },
        ].map(item => (
          <div key={item.label} style={{
            flex: 1,
            background: theme.tagBg,
            borderRadius: "8px",
            padding: "10px 8px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "18px", marginBottom: "4px" }}>{item.emoji}</div>
            <div style={{ fontSize: "9px", color: theme.subtext, fontWeight: 700, letterSpacing: "0.8px" }}>{item.label}</div>
            <div style={{ fontSize: "14px", fontWeight: 800, color: theme.text, marginTop: "3px" }}>{item.val}</div>
          </div>
        ))}
      </div>
      {content.note && (
        <p style={{ fontSize: "11px", color: theme.subtext, lineHeight: 1.5, fontStyle: "italic", margin: 0 }}>
          {content.note}
        </p>
      )}
      {content.holiday && (
        <div style={{
          marginTop: "10px",
          padding: "8px 10px",
          borderRadius: "7px",
          background: "rgba(200,100,0,0.13)",
          borderLeft: `3px solid ${theme.accent}`,
          display: "flex",
          alignItems: "flex-start",
          gap: "6px",
        }}>
          <span style={{ fontSize: "13px", flexShrink: 0, marginTop: "1px" }}>🎄</span>
          <p style={{ fontSize: "10px", color: theme.text, margin: 0, lineHeight: 1.5, fontWeight: 600 }}>
            {content.holiday}
          </p>
        </div>
      )}
    </CardShell>
  );
}

function VariationsCard({ theme, content, photo }: { theme: Theme; content: Record<string, string>; photo: string | null }) {
  const vars = [
    { key: "A", val: content.varA },
    { key: "B", val: content.varB },
    { key: "C", val: content.varC },
    { key: "D", val: content.varD },
  ].filter(v => v.val);
  return (
    <CardShell theme={theme} photo={photo}>
      <Hdg theme={theme} text={content.heading || "Design Variations"} />
      <Rule theme={theme} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
        {vars.map(v => (
          <div key={v.key} style={{
            background: theme.tagBg, borderRadius: "8px",
            padding: "8px 10px",
            display: "flex", alignItems: "center", gap: "8px",
          }}>
            <span style={{
              width: "20px", height: "20px", borderRadius: "50%",
              background: theme.accent, color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "10px", fontWeight: 800, flexShrink: 0,
            }}>{v.key}</span>
            <span style={{ fontSize: "11.5px", color: theme.text, fontWeight: 600, lineHeight: 1.2 }}>{v.val}</span>
          </div>
        ))}
      </div>
      {content.note && (
        <p style={{ fontSize: "10.5px", color: theme.subtext, margin: 0 }}>{content.note}</p>
      )}
    </CardShell>
  );
}

// ─── Form helpers ──────────────────────────────────────────────────────────────

function FF({ label, value, onChange, multiline = false }: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      {multiline
        ? <Textarea value={value} onChange={e => onChange(e.target.value)} className="text-sm resize-none" rows={3} />
        : <Input value={value} onChange={e => onChange(e.target.value)} className="text-sm" />
      }
    </div>
  );
}

function FeaturesForm({ c, oc }: { c: Record<string,string>; oc:(k:string,v:string)=>void }) {
  return <div className="space-y-3">
    <FF label="Heading" value={c.heading} onChange={v=>oc("heading",v)} />
    {["b1","b2","b3","b4","b5"].map((k,i)=>(
      <FF key={k} label={`Feature ${i+1}`} value={c[k]} onChange={v=>oc(k,v)} />
    ))}
  </div>;
}
function SocialForm({ c, oc }: { c: Record<string,string>; oc:(k:string,v:string)=>void }) {
  return <div className="space-y-3">
    <FF label="Heading" value={c.heading} onChange={v=>oc("heading",v)} />
    <div>
      <Label className="text-xs text-muted-foreground mb-1 block">Stars</Label>
      <div className="flex gap-2">
        {[1,2,3,4,5].map(n=>(
          <button key={n} onClick={()=>oc("stars",String(n))}
            className={`text-2xl transition-opacity ${parseInt(c.stars||"5")>=n?"opacity-100":"opacity-30"}`}>⭐</button>
        ))}
      </div>
    </div>
    <FF label="Review quote" value={c.quote} onChange={v=>oc("quote",v)} multiline />
    <FF label="Reviewer name (optional)" value={c.reviewer} onChange={v=>oc("reviewer",v)} />
  </div>;
}
function PromiseForm({ c, oc }: { c: Record<string,string>; oc:(k:string,v:string)=>void }) {
  return <div className="space-y-3">
    <FF label="Heading" value={c.heading} onChange={v=>oc("heading",v)} />
    <FF label="Promise body" value={c.body} onChange={v=>oc("body",v)} multiline />
    <FF label="Closing tagline" value={c.sub} onChange={v=>oc("sub",v)} />
  </div>;
}
function ShippingForm({ c, oc }: { c: Record<string,string>; oc:(k:string,v:string)=>void }) {
  return <div className="space-y-3">
    <FF label="Heading" value={c.heading} onChange={v=>oc("heading",v)} />
    <div className="grid grid-cols-2 gap-3">
      <FF label="Production (days)" value={c.production} onChange={v=>oc("production",v)} />
      <FF label="Transit (days)" value={c.transit} onChange={v=>oc("transit",v)} />
    </div>
    <FF label="Note" value={c.note} onChange={v=>oc("note",v)} multiline />
    <FF label="🎄 Holiday warning (optional)" value={c.holiday||""} onChange={v=>oc("holiday",v)} multiline />
  </div>;
}
function VariationsForm({ c, oc }: { c: Record<string,string>; oc:(k:string,v:string)=>void }) {
  return <div className="space-y-3">
    <FF label="Heading" value={c.heading} onChange={v=>oc("heading",v)} />
    {["A","B","C","D"].map(k=>(
      <FF key={k} label={`Option ${k}`} value={c[`var${k}`]||""} onChange={v=>oc(`var${k}`,v)} />
    ))}
    <FF label="Note" value={c.note} onChange={v=>oc("note",v)} />
  </div>;
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function EtsyListingCards() {
  const { session } = useAuth();
  const { toast } = useToast();
  const previewRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [cardType, setCardType]   = useState<CardType>("features");
  const [niche, setNiche]         = useState<Niche>("wellness");
  const [theme, setTheme]         = useState<ThemePreset>("warm");
  const [productName, setProductName] = useState("");
  const [photo, setPhoto]         = useState<string | null>(null);
  const [content, setContent]     = useState<Record<CardType, Record<string, string>>>(
    Object.fromEntries(
      (Object.keys(DEFAULTS) as CardType[]).map(k => [k, { ...DEFAULTS[k] }])
    ) as Record<CardType, Record<string, string>>
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const t = THEMES[theme];
  const c = content[cardType];

  const oc = useCallback((key: string, value: string) => {
    setContent(prev => ({ ...prev, [cardType]: { ...prev[cardType], [key]: value } }));
  }, [cardType]);

  // Photo upload
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhoto(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  // AI suggest
  const suggestWithAI = async () => {
    if (!productName.trim()) {
      toast({ title: "Enter a product name first", variant: "destructive" });
      return;
    }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-card-copy", {
        body: { cardType, productName, currentContent: c },
      });
      if (error || !data?.content) throw new Error(error?.message || "No suggestions returned");
      setContent(prev => ({ ...prev, [cardType]: { ...prev[cardType], ...data.content } }));
      toast({ title: "AI suggestions applied" });
    } catch (err) {
      toast({ title: "AI suggestion failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  // Export PNG — 3× pixel ratio → ~1620×1260
  const downloadPng = async () => {
    if (!previewRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(previewRef.current, { pixelRatio: 3, cacheBust: true });
      const a = document.createElement("a");
      a.download = `listing-card-${cardType}-${theme}.png`;
      a.href = dataUrl;
      a.click();
      toast({ title: "Downloaded!", description: "Ready for your Etsy listing." });
    } catch {
      toast({ title: "Export failed — try again.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const renderCard = () => {
    const props = { theme: t, content: c, photo };
    switch (cardType) {
      case "features":   return <FeaturesCard   {...props} />;
      case "social":     return <SocialCard      {...props} />;
      case "promise":    return <PromiseCard     {...props} />;
      case "shipping":   return <ShippingCard    {...props} />;
      case "variations": return <VariationsCard  {...props} />;
    }
  };

  const renderForm = () => {
    const props = { c, oc };
    switch (cardType) {
      case "features":   return <FeaturesForm   {...props} />;
      case "social":     return <SocialForm     {...props} />;
      case "promise":    return <PromiseForm    {...props} />;
      case "shipping":   return <ShippingForm   {...props} />;
      case "variations": return <VariationsForm {...props} />;
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Layers className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold">Listing Card Generator</h1>
          <Badge className="bg-primary/10 text-primary border-0 text-xs">Etsy</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Build the info cards top Etsy sellers use — features, reviews, shipping, promise, and variations. Upload your product photo, pick a theme, and download.
        </p>
      </div>

      {/* Top bar: product name + photo upload + AI */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-48">
          <Label className="text-xs text-muted-foreground mb-1 block">Product name</Label>
          <Input placeholder="e.g. Personalized Heart Ornament" value={productName}
            onChange={e => setProductName(e.target.value)} className="text-sm" />
        </div>

        {/* Photo upload */}
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Product photo</Label>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => photoInputRef.current?.click()} className="gap-2">
              <ImagePlus className="w-4 h-4" />
              {photo ? "Change photo" : "Upload photo"}
            </Button>
            {photo && (
              <button onClick={() => setPhoto(null)} className="text-muted-foreground hover:text-destructive">
                <X className="w-4 h-4" />
              </button>
            )}
            <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={suggestWithAI} disabled={aiLoading} className="gap-2 shrink-0">
          {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          AI Suggest
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* ── Left panel ─────────────────────────── */}
        <div className="space-y-5">
          {/* Card type */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Card Type</p>
            <div className="space-y-1.5">
              {(Object.entries(CARD_META) as [CardType, typeof CARD_META[CardType]][]).map(([type, meta]) => (
                <button key={type} onClick={() => setCardType(type)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all text-sm
                    ${cardType === type
                      ? "bg-primary/10 text-primary border border-primary/20 font-medium"
                      : "bg-card hover:bg-muted/60 border border-border/40"}`}>
                  {meta.icon}
                  <div>
                    <div className="font-medium leading-none">{meta.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{meta.hint}</div>
                  </div>
                  {cardType === type && <ChevronRight className="w-4 h-4 ml-auto text-primary" />}
                </button>
              ))}
            </div>
          </div>

          {/* Niche + Theme */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5" /> Style Theme
            </p>
            {/* Niche tabs */}
            <div className="flex gap-1 mb-2 bg-muted/50 p-1 rounded-lg">
              {(Object.entries(NICHE_THEMES) as [Niche, typeof NICHE_THEMES[Niche]][]).map(([n, { label }]) => (
                <button key={n} onClick={() => {
                  setNiche(n);
                  setTheme(NICHE_THEMES[n].themes[0]);
                }}
                  className={`flex-1 text-[11px] font-medium py-1 px-2 rounded-md transition-all
                    ${niche === n ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  {label}
                </button>
              ))}
            </div>
            {/* Theme swatches for selected niche */}
            <div className="flex gap-2 flex-wrap">
              {NICHE_THEMES[niche].themes.map(key => (
                <button key={key} onClick={() => setTheme(key)} title={THEMES[key].name}
                  className={`h-9 flex-1 min-w-0 rounded-md border-2 transition-all ${theme === key ? "border-primary scale-110 shadow-md" : "border-transparent hover:border-border"}`}
                  style={{ background: THEMES[key].grad }} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 text-center">{t.name}</p>
          </div>

          {/* Content form */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Card Text</p>
            <div className="bg-card border border-border/40 rounded-lg p-4 space-y-3">
              {renderForm()}
            </div>
          </div>
        </div>

        {/* ── Right panel: preview + download ───── */}
        <div className="space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Preview</p>
          <div className="flex justify-center">
            <div ref={previewRef} style={{ borderRadius: "10px", overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.20)" }}>
              {renderCard()}
            </div>
          </div>

          <div className="flex justify-center gap-3">
            <Button onClick={downloadPng} disabled={exporting} size="lg" className="gap-2 px-8">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {exporting ? "Exporting…" : "Download PNG"}
            </Button>
          </div>

          <div className="bg-muted/40 border border-border/30 rounded-lg p-4 text-xs text-muted-foreground leading-relaxed max-w-xl mx-auto">
            <strong className="text-foreground">How to use this for a full listing set:</strong> Use Media Tools to generate your hero + lifestyle mockups, then create all 5 info cards here. That gives you a complete 7–9 image listing that looks like a top Etsy shop — not just pretty photos.
          </div>
        </div>
      </div>
    </div>
  );
}
