import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CopyButtonProps {
  text: string;
  label?: string;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "outline" | "ghost" | "secondary";
  className?: string;
}

export function CopyButton({ text, label, size = "sm", variant = "outline", className = "" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: "Copied!", description: label ? `${label} copied to clipboard` : "Copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Unable to copy to clipboard", variant: "destructive" });
    }
  };

  return (
    <Button size={size} variant={variant} className={className} onClick={handleCopy}>
      {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
      {copied ? "Copied" : label || "Copy"}
    </Button>
  );
}

export function copyAllFields(fields: { label: string; value: string }[]) {
  const text = fields
    .filter((f) => f.value)
    .map((f) => `${f.label}:\n${f.value}`)
    .join("\n\n---\n\n");
  return text;
}
