import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FileText, Sparkles } from "lucide-react";

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

function toFeatureList(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function toBenefitPhrase(feature: string) {
  const normalized = feature.trim();
  if (!normalized) return "supports everyday use";
  return `helps you get more from ${normalized.toLowerCase()}`;
}

function buildDescriptionContent(product: ProductSlot, context: string) {
  const features = toFeatureList(product.features);
  const strategy = context.trim();
  const benefitLine = features.length > 0
    ? `${product.title} is built to ${toBenefitPhrase(features[0])} while keeping the overall experience clean, reliable, and easy to understand.`
    : `${product.title} is designed to solve real customer needs with straightforward value, dependable quality, and an easy fit in daily use.`;

  const audienceLine = strategy
    ? `This description leans into your current brand strategy: ${strategy}.`
    : `This copy stays benefit-driven, easy to scan, and focused on helping the customer quickly understand why the product is worth choosing.`;

  const bulletItems = features.length > 0
    ? features.map((feature) => `<li>${feature}</li>`).join("")
    : "<li>Clear everyday value</li><li>Practical, customer-friendly use</li><li>Simple positioning for faster decision-making</li>";

  const closingLine = features.length > 1
    ? `Instead of listing raw specs without context, this positioning connects the strongest details, like ${features.slice(0, 2).join(" and ")}, to the outcome the buyer actually cares about.`
    : "Instead of sounding like manufacturer copy, this version stays specific, readable, and centered on what the customer gains from the product.";

  return `
    <div>
      <h3>Why Customers Notice It</h3>
      <p>${benefitLine}</p>
      <p>${audienceLine}</p>
      <h4>Highlights</h4>
      <ul>${bulletItems}</ul>
      <h4>Why It Works</h4>
      <p>${closingLine}</p>
      <p>Use supporting product images, clear alt text, and consistent store language around this description so the page feels trustworthy and easy to scan on Shopify.</p>
    </div>
  `.trim();
}

export default function DescriptionsPage() {
  const [context, setContext] = useState("");
  const [products, setProducts] = useState<ProductSlot[]>(emptySlots);
  const [results, setResults] = useState<GeneratedDescription[]>([]);
  const [loading, setLoading] = useState(false);

  const handleUpdate = (index: number, field: keyof Omit<ProductSlot, "id">, value: string) => {
    setProducts((previous) =>
      previous.map((product, productIndex) =>
        productIndex === index ? { ...product, [field]: value } : product,
      ),
    );
  };

  const handleGenerate = () => {
    setLoading(true);
    window.setTimeout(() => {
      setResults(
        products
          .filter((product) => product.title.trim())
          .map((product) => ({
            title: product.title,
            content: buildDescriptionContent(product, context),
          })),
      );
      setLoading(false);
    }, 600);
  };

  const activeCount = products.filter((product) => product.title.trim()).length;

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" /> Description Generator
        </h1>
        <p className="text-muted-foreground mt-1">
          Shopify-ready copy blocks that stay scannable, benefit-driven, and easy to review in batches.
        </p>
      </motion.div>

      <Card className="bg-card/50 border-border/30">
        <CardHeader>
          <CardTitle className="text-lg">Brand Strategy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="e.g. Speak to collectors who want premium finish, everyday wear, and fast visual trust in the first paragraph."
            value={context}
            onChange={(event) => setContext(event.target.value)}
            className="bg-muted/50"
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            The generator favors benefit-led copy, short sections, and bullet points instead of dense manufacturer-style paragraphs.
          </p>
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
          {products.map((product, index) => (
            <div key={product.id} className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input
                placeholder={`Product ${index + 1} title`}
                value={product.title}
                onChange={(event) => handleUpdate(index, "title", event.target.value)}
                className="bg-muted/50"
              />
              <Input
                placeholder="Key features or materials, separated by commas"
                value={product.features}
                onChange={(event) => handleUpdate(index, "features", event.target.value)}
                className="bg-muted/50"
              />
            </div>
          ))}
          <Button
            onClick={handleGenerate}
            disabled={loading || activeCount === 0}
            className="w-full gradient-phoenix text-primary-foreground"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {loading ? "Generating..." : `Generate ${activeCount} Description${activeCount !== 1 ? "s" : ""}`}
          </Button>
        </CardContent>
      </Card>

      {results.length > 0 ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          {results.map((result) => (
            <Card key={result.title} className="bg-card/50 border-border/30">
              <CardHeader>
                <CardTitle className="text-base">{result.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: result.content }} />
              </CardContent>
            </Card>
          ))}
        </motion.div>
      ) : null}
    </div>
  );
}
