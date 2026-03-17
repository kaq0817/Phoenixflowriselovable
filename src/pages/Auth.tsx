import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, LogIn, UserPlus, Mail, Lock, User } from "lucide-react";

export default function Auth() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
    } else {
      navigate("/");
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: window.location.origin,
      },
    });
    setLoading(false);
    if (error) {
      toast({ title: "Signup failed", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: "Check your email",
        description: "We sent you a confirmation link. Please verify your email to sign in.",
      });
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Check your email", description: "We sent you a password reset link." });
      setResetMode(false);
    }
  };

  if (resetMode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <Card className="bg-card/50 border-border/30">
            <CardHeader className="text-center">
              <Mail className="h-10 w-10 text-primary mx-auto mb-2" />
              <CardTitle className="text-xl">Reset Password</CardTitle>
              <p className="text-sm text-muted-foreground">Enter your email to receive a reset link</p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleReset} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
                </div>
                <Button type="submit" className="w-full gradient-phoenix text-primary-foreground" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
                  Send Reset Link
                </Button>
                <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={() => setResetMode(false)}>
                  Back to login
                </Button>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <Card className="bg-card/50 border-border/30">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 h-12 w-12 rounded-full gradient-phoenix flex items-center justify-center">
              {mode === "login" ? <LogIn className="h-6 w-6 text-primary-foreground" /> : <UserPlus className="h-6 w-6 text-primary-foreground" />}
            </div>
            <CardTitle className="text-xl">{mode === "login" ? "Welcome Back" : "Create Account"}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {mode === "login" ? "Sign in to your Phoenix Flow account" : "Get started with Phoenix Flow"}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={mode === "login" ? handleLogin : handleSignup} className="space-y-4">
              {mode === "signup" && (
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" className="pl-9" />
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" className="pl-9" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" minLength={6} className="pl-9" />
                </div>
              </div>
              {mode === "login" && (
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setResetMode(true)}>
                  Forgot password?
                </button>
              )}
              <Button type="submit" className="w-full gradient-phoenix text-primary-foreground" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {mode === "login" ? "Sign In" : "Create Account"}
              </Button>
            </form>
            <div className="mt-4 text-center text-sm text-muted-foreground">
              {mode === "login" ? "Don't have an account? " : "Already have an account? "}
              <button className="text-primary hover:underline font-medium" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
                {mode === "login" ? "Sign up" : "Sign in"}
              </button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
