import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Image, Wand2, Type, Palette } from "lucide-react";

const tools = [
  { icon: Type, title: "Alt Text Generator", desc: "AI-generated SEO-friendly alt text for all product images.", action: "Generate Alt Text", badge: "AI" },
  { icon: Wand2, title: "Background Remover", desc: "Clean product photos with one-click background removal.", action: "Remove Backgrounds", badge: "PRO" },
  { icon: Image, title: "Image Optimizer", desc: "Compress and resize images for faster page loads.", action: "Optimize Images", badge: "All" },
  { icon: Palette, title: "Watermark Tool", desc: "Add branded watermarks to protect your product photos.", action: "Add Watermarks", badge: "PRO" },
];

export default function MediaPage() {
  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Image className="h-6 w-6 text-primary" /> Media Tools
        </h1>
        <p className="text-muted-foreground mt-1">Image optimization and SEO media suite.</p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tools.map((tool, i) => (
          <motion.div key={tool.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
            <Card className="bg-card/50 border-border/30 hover:border-primary/30 transition-colors h-full">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2"><tool.icon className="h-5 w-5 text-primary" />{tool.title}</span>
                  <Badge variant="outline" className="text-xs">{tool.badge}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">{tool.desc}</p>
                <Button variant="secondary" className="w-full">{tool.action}</Button>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
