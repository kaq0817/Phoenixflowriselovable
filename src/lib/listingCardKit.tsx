// Shared card-rendering kit for Listing Cards — used by both the single-card
// manual editor (ListingCards.tsx) and the bulk generator (BulkListingCards.tsx)
// so the five card designs live in exactly one place.
import { toCanvas } from "html-to-image";
import {
  Star, Shield, CheckCircle, Truck, Layers,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CardType = "features" | "social" | "promise" | "shipping" | "variations";
export type ThemePreset = "warm" | "rose" | "sage" | "ocean" | "dark" | "iron" | "void";
export type Niche = "wellness" | "gaming";

export interface Theme {
  name: string;
  bg: string;
  grad: string;
  floral: string;
  text: string;
  accent: string;
  subtext: string;
  divider: string;
  photoBorder: string;
  tagBg: string;
  tagText: string;
}

// ─── Themes ───────────────────────────────────────────────────────────────────

export const THEMES: Record<ThemePreset, Theme> = {
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

export const NICHE_THEMES: Record<Niche, { label: string; themes: ThemePreset[] }> = {
  wellness: { label: "Warm & Soft", themes: ["warm", "rose", "sage", "ocean"] },
  gaming:   { label: "Bold & Dark", themes: ["dark", "iron", "void"] },
};

// Same brand-matching heuristic as generate-descriptions' pickBrandVoice, so the
// bulk generator can pick a sensible default niche/theme per store without asking.
export function pickNicheForStore(storeLabel: string | undefined): Niche {
  const label = (storeLabel || "").toLowerCase();
  if (label.includes("ironphoenix") || label.includes("iron-phoenix") || label.includes("gohardgaming")) {
    return "gaming";
  }
  return "wellness";
}

// ─── Card type metadata ────────────────────────────────────────────────────────

export const CARD_META: Record<CardType, { label: string; icon: React.ReactNode; hint: string }> = {
  features:   { label: "Made With Care",  icon: <CheckCircle className="w-4 h-4" />, hint: "Features & quality bullets" },
  social:     { label: "Customer Love",   icon: <Star className="w-4 h-4" />,        hint: "Stars & review quote" },
  promise:    { label: "Our Promise",     icon: <Shield className="w-4 h-4" />,      hint: "Guarantee & satisfaction" },
  shipping:   { label: "Shipping Info",   icon: <Truck className="w-4 h-4" />,       hint: "Production & delivery times" },
  variations: { label: "Design Options",  icon: <Layers className="w-4 h-4" />,      hint: "A / B / C / D variations" },
};

export const CARD_TYPES: CardType[] = ["features", "social", "promise", "shipping", "variations"];

// ─── Default content ───────────────────────────────────────────────────────────

export const DEFAULTS: Record<CardType, Record<string, string>> = {
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
// Exported at 3× = 1620×1260 (wide landscape listing image)
export const W = 540;
export const H = 420;

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
              <img src={photo} alt="product" style={{ width: "100%", height: "100%", objectFit: "cover" }} crossOrigin="anonymous" />
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

interface CardProps { theme: Theme; content: Record<string, string>; photo: string | null; }

function FeaturesCard({ theme, content, photo }: CardProps) {
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

function SocialCard({ theme, content, photo }: CardProps) {
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

function PromiseCard({ theme, content, photo }: CardProps) {
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

function ShippingCard({ theme, content, photo }: CardProps) {
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

function VariationsCard({ theme, content, photo }: CardProps) {
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

export function CardRenderer({ cardType, theme, content, photo }: { cardType: CardType } & CardProps) {
  switch (cardType) {
    case "features":   return <FeaturesCard   theme={theme} content={content} photo={photo} />;
    case "social":     return <SocialCard     theme={theme} content={content} photo={photo} />;
    case "promise":    return <PromiseCard    theme={theme} content={content} photo={photo} />;
    case "shipping":   return <ShippingCard   theme={theme} content={content} photo={photo} />;
    case "variations": return <VariationsCard theme={theme} content={content} photo={photo} />;
  }
}

// ─── Export helper ──────────────────────────────────────────────────────────────

// Renders a mounted DOM node to a WebP data URL. Used for both the single-card
// download and the bulk generator's per-card Shopify upload — WebP to match the
// rest of the app's image pipeline (mockups, upload-shopify-webp).
export async function renderElementToWebpDataUrl(el: HTMLElement, pixelRatio = 3, quality = 0.92): Promise<string> {
  const canvas = await toCanvas(el, { pixelRatio, cacheBust: true });
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("Canvas export failed")); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Could not read exported image"));
      reader.readAsDataURL(blob);
    }, "image/webp", quality);
  });
}
