import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, Send, User } from "lucide-react";

const initialMessages = [
  { sender: "bot", text: "Hello! I'm the Phoenix Flow Assistant. I can help you analyze and optimize your store. What can I help you with?" },
];

const botResponses = [
  "I've analyzed your request. Based on your store data, I recommend focusing on product descriptions first — they have the highest ROI for SEO.",
  "Your top 5 products have an average SEO score of 72. I can generate optimized titles and descriptions for them. Want me to proceed?",
  "For compliance, I notice you're missing a shipping policy. This could trigger Google Merchant Center flags. I'd recommend adding one ASAP.",
  "Your inventory sync is up to date. 3 products from CJ Dropshipping are out of stock and have been auto-archived.",
  "I can help with that! Try using the Bulk Analyzer to triage your entire catalog, or the Description Generator for targeted content updates.",
];

export default function BotPage() {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = () => {
    if (!input.trim()) return;
    const userMsg = { sender: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);
    setTimeout(() => {
      const response = botResponses[Math.floor(Math.random() * botResponses.length)];
      setMessages((prev) => [...prev, { sender: "bot", text: response }]);
      setIsTyping(false);
    }, 1200);
  };

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-8rem)]">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bot className="h-6 w-6 text-primary" /> AI Assistant
        </h1>
        <p className="text-muted-foreground mt-1">Your Phoenix Flow co-pilot.</p>
      </motion.div>

      <Card className="bg-card/50 border-border/30 flex-1 flex flex-col min-h-0">
        <CardContent className="flex-1 overflow-auto p-4 space-y-3">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
              {msg.sender === "bot" && (
                <div className="h-7 w-7 rounded-full gradient-phoenix flex items-center justify-center shrink-0 mt-1">
                  <Bot className="h-3.5 w-3.5 text-primary-foreground" />
                </div>
              )}
              <div className={`max-w-[75%] p-3 rounded-xl text-sm ${msg.sender === "user" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted/50 rounded-bl-sm"}`}>
                {msg.text}
              </div>
              {msg.sender === "user" && (
                <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-1">
                  <User className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
          ))}
          {isTyping && (
            <div className="flex gap-2">
              <div className="h-7 w-7 rounded-full gradient-phoenix flex items-center justify-center shrink-0">
                <Bot className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
              <div className="bg-muted/50 p-3 rounded-xl rounded-bl-sm">
                <div className="flex gap-1">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse" />
                  <span className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse" style={{ animationDelay: "0.2s" }} />
                  <span className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse" style={{ animationDelay: "0.4s" }} />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </CardContent>
        <div className="p-4 border-t border-border/30">
          <div className="flex gap-2">
            <Input placeholder="Ask anything about your store..." value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} className="bg-muted/50" />
            <Button onClick={send} size="icon" className="gradient-phoenix text-primary-foreground shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
