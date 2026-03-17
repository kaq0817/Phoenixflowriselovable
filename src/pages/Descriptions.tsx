import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FileText, Sparkles } from "lucide-react";

const emptySlots = Array.from({ length: 5 }, (_, i) => ({ id: String(i + 1), title: "", features: "" }));

export default function DescriptionsPage() {
  const [context, setContext] = useState("");
  const [products, setProducts] = useState(emptySlots);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleUpdate = (index: number, field: string, value: string) => {
    setProducts((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };

  const handleGenerate = () => {
    setLoading(true);
    setTimeout(() => {
      setResults(
        products.filter((p) => p.title).map((p) => ({
          title: p.title,
          content: `<p>Discover the exceptional quality of the <strong>${p.title}</strong>. ${p.features ? `Featuring ${p.features}, this` : "This"} product is designed for those who demand excellence. ${context ? `Perfect for ${context}.` : ""} Elevate your collection today with a piece that combines artistry and purpose.</p>`,
        }))
      );
      setLoading(false);
    }, 2000);
  };

  const activeCount = products.filter((p) => p.title).length;

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" /> Description Generator
        </h1>
        <p className="text-muted-foreground mt-1">Creative batch generator — up to 5 products per burst.</p>
      </motion.div>

      <Card className="bg-card/50 border-border/30">
        <CardHeader><CardTitle className="text-lg">Brand Strategy</CardTitle></CardHeader>
        <CardContent>
          <Textarea placeholder="e.g. Focus on luxury appeal for Gen Z collectors..." value={context} onChange={(e) => setContext(e.target.value)} className="bg-muted/50" rows={2} />
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/30">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-lg">
            <span>Products</span>
            <Badge variant="secondary">{activeCount}/5 slots</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {products.map((p, i) => (
            <div key={p.id} className="grid grid-cols-2 gap-3">
              <Input placeholder={`Product ${i + 1} title`} value={p.title} onChange={(e) => handleUpdate(i, "title", e.target.value)} className="bg-muted/50" />
              <Input placeholder="Key features..." value={p.features} onChange={(e) => handleUpdate(i, "features", e.target.value)} className="bg-muted/50" />
            </div>
          ))}
          <Button onClick={handleGenerate} disabled={loading || activeCount === 0} className="w-full gradient-phoenix text-primary-foreground">
            <Sparkles className="mr-2 h-4 w-4" /> {loading ? "Generating..." : `Generate ${activeCount} Description${activeCount !== 1 ? "s" : ""}`}
          </Button>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          {results.map((r, i) => (
            <Card key={i} className="bg-card/50 border-border/30">
              <CardHeader><CardTitle className="text-base">{r.title}</CardTitle></CardHeader>
              <CardContent>
                <div className="prose prose-sm prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: r.content }} />
              </CardContent>
            </Card>
          ))}
        </motion.div>
      )}
    </div>
  );
}
