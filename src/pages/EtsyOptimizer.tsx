import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck, Sparkles, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function EtsyOptimizer() {
  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Store className="h-6 w-6 text-primary" /> Etsy Optimizer
        </h1>
        <p className="text-muted-foreground mt-1">
          Etsy now runs through the main optimizer flow with OAuth-backed connections, listing reads, and direct apply support.
        </p>
      </motion.div>

      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-8 space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg bg-muted/20 p-4">
              <ShieldCheck className="h-5 w-5 text-primary mb-2" />
              <p className="font-medium text-sm">Review-friendly OAuth</p>
              <p className="text-xs text-muted-foreground mt-1">Minimal Etsy scopes, signed state, and clearer callback handling.</p>
            </div>
            <div className="rounded-lg bg-muted/20 p-4">
              <Store className="h-5 w-5 text-primary mb-2" />
              <p className="font-medium text-sm">Live shop connection</p>
              <p className="text-xs text-muted-foreground mt-1">Connect Etsy in Settings, then work from the shared optimizer page.</p>
            </div>
            <div className="rounded-lg bg-muted/20 p-4">
              <Sparkles className="h-5 w-5 text-primary mb-2" />
              <p className="font-medium text-sm">Direct listing workflow</p>
              <p className="text-xs text-muted-foreground mt-1">Fetch listings, generate suggestions, copy or apply changes, and keep snapshots for undo.</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button className="gradient-phoenix text-primary-foreground flex-1" onClick={() => { window.location.href = "/optimizer"; }}>
              Open Main Optimizer
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => { window.location.href = "/settings"; }}>
              Review Etsy Connection
            </Button>
          </div>

          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <ArrowRight className="h-3 w-3" /> Etsy optimization is no longer a separate broken screen. Use this page as the entry point into the cleaned-up flow.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
