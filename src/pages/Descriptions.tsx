import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FileText, Sparkles, Copy, Check, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface ProductSlot {
  id: string;
  title: string;
  features: string;
}

interface GeneratedDescription {
  title: string;
  content: string;
}

const emptySlots: ProductSlot[] = Array.from({ length: 5 }, (_, index) => ({
  id: String(index + 1),
  title: "",
  features: "",
}));


export default function DescriptionsPage() {
  const { toast } = useToast();
  const [context, setContext] = useState("");
  const [products, setProducts] = useState<ProductSlot[]>(emptySlots);
  const [results, setResults] = useState<GeneratedDescription[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleUpdate = (index: number, field: keyof Omit<ProductSlot, "id">, value: string) => {
    setProducts((previous) =>
      previous.map((product, productIndex) =>
        productIndex === index ? { ...product, [field]: value } : product,
      ),
    );
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-descriptions", {
        body: { products, globalContext: context },
      });
      if (error) throw error;
      setResults(data.results ?? []);
      toast({ title: "Descriptions Generated", description: "Gemini-optimized for GMC compliance." });
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: (err as Error).message || "Failed to generate descriptions." });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (content: string, id: string) => {
    // Strip HTML for clipboard or keep if needed for Shopify
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Copied!", description: "HTML content ready for Shopify." });
  };

  const activeCount = products.filter((product) => product.title.trim()).length;

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" /> PHX DESC-GEN v2.0
        </h1>
        <p className="text-muted-foreground mt-1">
          Binary-compliant Shopify descriptions. Enforces 100% SEO alignment and brand identity.
        </p>
      </motion.div>

      <Card className="bg-card/50 border-border/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Global Brand Context
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="e.g. Focus on durability and outdoor performance, or highlight eco-friendly materials and wellness benefits."
            value={context}
            onChange={(event) => setContext(event.target.value)}
            className="bg-muted/30 border-border/40"
            rows={2}
          />
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/30">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-lg">
            <span>Product Batch Input</span>
            <Badge variant="outline" className="text-primary border-primary/30">
              {activeCount}/5 Slots Active
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {products.map((product, index) => (
            <div key={product.id} className="grid grid-cols-1 gap-3 md:grid-cols-2 p-3 rounded-lg border border-border/10 bg-muted/10">
              <div className="space-y-1">
                <p className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Title</p>
                <Input
                  placeholder="e.g. Ashwagandha Capsules"
                  value={product.title}
                  onChange={(event) => handleUpdate(index, "title", event.target.value)}
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Features / Materials</p>
                <Input
                  placeholder="60ct, Organic, Made in USA"
                  value={product.features}
                  onChange={(event) => handleUpdate(index, "features", event.target.value)}
                  className="bg-background/50"
                />
              </div>
            </div>
          ))}
          <Button
            onClick={handleGenerate}
            disabled={loading || activeCount === 0}
            className="w-full gradient-phoenix text-primary-foreground font-bold"
          >
            {loading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Process Batch...</>
            ) : (
              <><Sparkles className="mr-2 h-4 w-4" /> Generate {activeCount} Compliant Descriptions</>
            )}
          </Button>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-primary ml-1">Output — Edit Before Copying</h2>
          {results.map((result, idx) => (
            <Card key={idx} className="bg-card/30 border-primary/20 overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between py-3 bg-muted/20">
                <CardTitle className="text-sm font-bold text-primary">{result.title}</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(result.content, String(idx))}
                  className="h-8 gap-2"
                >
                  {copiedId === String(idx) ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  <span className="text-[10px] uppercase font-bold">Copy HTML</span>
                </Button>
              </CardHeader>
              <CardContent className="pt-4">
                <textarea
                  className="w-full rounded-md border border-primary/20 bg-black/20 px-3 py-3 text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                  rows={Math.max(6, Math.ceil(result.content.length / 80))}
                  value={result.content}
                  onChange={(e) => setResults((prev) => prev.map((r, i) => i === idx ? { ...r, content: e.target.value } : r))}
                />
              </CardContent>
            </Card>
          ))}
        </motion.div>
      )}
    </div>
  );
}

