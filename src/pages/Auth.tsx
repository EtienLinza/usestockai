import { SEO } from "@/components/SEO";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { toast } from "sonner";
import { Loader2, Mail, Lock, ArrowLeft, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { z } from "zod";

const authSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters")
});

const Auth = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signIn, signUp } = useAuth();
  
  const [isSignUp, setIsSignUp] = useState(searchParams.get("mode") === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // MFA challenge state
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaChallengeId, setMfaChallengeId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaVerifying, setMfaVerifying] = useState(false);

  const finishLogin = async () => {
    await logAudit("login", undefined, { method: mfaFactorId ? "password+totp" : "password" });
    toast.success("Welcome back!");
    navigate("/dashboard");
  };

  const maybeChallengeMfa = async (): Promise<boolean> => {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return false;
    if (data.currentLevel === "aal2" || data.nextLevel !== "aal2") return false;
    const list = await supabase.auth.mfa.listFactors();
    const factor = list.data?.totp?.find((f) => f.status === "verified");
    if (!factor) return false;
    const ch = await supabase.auth.mfa.challenge({ factorId: factor.id });
    if (ch.error || !ch.data) {
      toast.error(ch.error?.message ?? "Could not start 2FA challenge");
      return false;
    }
    setMfaFactorId(factor.id);
    setMfaChallengeId(ch.data.id);
    return true;
  };

  const verifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaFactorId || !mfaChallengeId || mfaCode.length !== 6) return;
    setMfaVerifying(true);
    const { error } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: mfaChallengeId,
      code: mfaCode,
    });
    setMfaVerifying(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await finishLogin();
  };

  const cancelMfa = async () => {
    await supabase.auth.signOut();
    setMfaFactorId(null);
    setMfaChallengeId(null);
    setMfaCode("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate inputs with Zod
    const result = authSchema.safeParse({ email, password });
    if (!result.success) {
      toast.error(result.error.errors[0].message);
      return;
    }

    setIsLoading(true);

    try {
      if (isSignUp) {
        const { error } = await signUp(email, password);
        if (error) {
          toast.error(error.message);
        } else {
          toast.success("Account created successfully!");
          navigate("/dashboard");
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          toast.error(error.message);
        } else {
          const needsMfa = await maybeChallengeMfa();
          if (!needsMfa) await finishLogin();
        }
      }
    } catch (err) {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO
        title={isSignUp ? "Create your StockAI account" : "Sign in to StockAI"}
        description="Sign in or create a free StockAI account to access live AI trading signals, backtesting, and a virtual portfolio."
        path="/auth"
        noindex
      />
      {/* Background effects */}
      <div className="fixed inset-0 bg-gradient-hero pointer-events-none" />
      <div className="fixed top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      
      {/* Back link */}
      <div className="p-4 relative z-10">
        <Link to="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <Logo size="md" />
            </div>
            <p className="text-muted-foreground">
              {isSignUp ? "Create an account to start tracking the market" : "Sign in to access your dashboard"}
            </p>
          </div>

          <Card variant="glass">
            <CardHeader>
              <CardTitle>{isSignUp ? "Create Account" : "Welcome Back"}</CardTitle>
              <CardDescription>
                {isSignUp 
                  ? "Enter your email to get started" 
                  : "Enter your credentials to continue"
                }
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mfaChallengeId ? (
                <form onSubmit={verifyMfa} className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ShieldCheck className="w-4 h-4 text-primary" />
                    Enter the 6-digit code from your authenticator app to finish signing in.
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mfa-code">Authentication code</Label>
                    <Input
                      id="mfa-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="123456"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="font-mono tracking-widest text-center text-lg"
                      autoFocus
                    />
                  </div>
                  <Button type="submit" variant="glow" size="lg" className="w-full" disabled={mfaCode.length !== 6 || mfaVerifying}>
                    {mfaVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify & continue"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="w-full" onClick={cancelMfa}>
                    Cancel and sign out
                  </Button>
                </form>
              ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      variant="glow"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      variant="glow"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isSignUp ? "Must include uppercase, lowercase, number, and special character" : ""}
                  </p>
                </div>

                <Button
                  type="submit"
                  variant="glow"
                  size="lg"
                  className="w-full"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {isSignUp ? "Creating Account..." : "Signing In..."}
                    </>
                  ) : (
                    isSignUp ? "Create Account" : "Sign In"
                  )}
                </Button>
              </form>
              )}

              {!mfaChallengeId && (
                <div className="mt-6 text-center">
                  <button
                    type="button"
                    onClick={() => setIsSignUp(!isSignUp)}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    {isSignUp
                      ? "Already have an account? Sign in"
                      : "Don't have an account? Sign up"
                    }
                  </button>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground mt-6">
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </p>
        </motion.div>
      </div>
    </div>
  );
};

export default Auth;
