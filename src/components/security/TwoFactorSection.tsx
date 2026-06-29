import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Shield, Loader2, KeyRound, Check, X, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { Link } from "react-router-dom";

interface Factor {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: string;
  created_at: string;
}

export function TwoFactorSection() {
  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollData, setEnrollData] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [disabling, setDisabling] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      console.warn("[mfa] list failed", error);
    } else {
      const totp = (data?.totp ?? []) as Factor[];
      setFactors(totp);
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const verified = factors.filter((f) => f.status === "verified");
  const isEnabled = verified.length > 0;

  const startEnroll = async () => {
    setEnrolling(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setEnrolling(false);
    if (error || !data) {
      toast.error(error?.message ?? "Could not start 2FA setup");
      return;
    }
    setEnrollData({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode("");
  };

  const cancelEnroll = async () => {
    if (enrollData) {
      await supabase.auth.mfa.unenroll({ factorId: enrollData.id }).catch(() => {});
    }
    setEnrollData(null);
    setCode("");
  };

  const verifyEnroll = async () => {
    if (!enrollData || code.length !== 6) return;
    setVerifying(true);
    const ch = await supabase.auth.mfa.challenge({ factorId: enrollData.id });
    if (ch.error || !ch.data) {
      setVerifying(false);
      toast.error(ch.error?.message ?? "Challenge failed");
      return;
    }
    const v = await supabase.auth.mfa.verify({
      factorId: enrollData.id,
      challengeId: ch.data.id,
      code,
    });
    setVerifying(false);
    if (v.error) {
      toast.error(v.error.message);
      return;
    }
    toast.success("Two-factor authentication enabled");
    logAudit("mfa_enabled", { type: "factor", id: enrollData.id });
    setEnrollData(null);
    setCode("");
    refresh();
  };

  const disable = async (factorId: string) => {
    if (!confirm("Disable two-factor authentication? You'll only need your password to sign in.")) return;
    setDisabling(factorId);
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    setDisabling(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Two-factor disabled");
    logAudit("mfa_disabled", { type: "factor", id: factorId });
    refresh();
  };

  const copySecret = async () => {
    if (!enrollData) return;
    await navigator.clipboard.writeText(enrollData.secret);
    toast.success("Secret copied");
  };

  return (
    <div className="space-y-4">
      <Card className="glass-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              <h3 className="font-medium">Two-factor authentication</h3>
              {isEnabled && (
                <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">
                  <Check className="w-3 h-3 mr-1" /> Active
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground max-w-prose">
              Add a one-time code from an authenticator app (Authy, 1Password, Google Authenticator)
              on top of your password. Strongly recommended.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : isEnabled ? (
          <div className="space-y-3">
            {verified.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-3 p-3 rounded-md border border-border/40 bg-muted/20"
              >
                <div className="text-sm">
                  <div className="font-medium flex items-center gap-2">
                    <KeyRound className="w-3.5 h-3.5" />
                    Authenticator app
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Enrolled {new Date(f.created_at).toLocaleDateString()}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => disable(f.id)}
                  disabled={disabling === f.id}
                >
                  {disabling === f.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      <X className="w-3.5 h-3.5 mr-1" /> Disable
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        ) : enrollData ? (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <div
                className="bg-white p-3 rounded-md shrink-0 w-[180px] h-[180px] flex items-center justify-center"
                dangerouslySetInnerHTML={{ __html: enrollData.qr }}
              />
              <div className="space-y-2 flex-1 min-w-0">
                <p className="text-sm">
                  1. Scan the QR with your authenticator app, or paste the secret below manually.
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-muted px-2 py-1.5 rounded break-all flex-1">
                    {enrollData.secret}
                  </code>
                  <Button variant="outline" size="sm" onClick={copySecret}>
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <p className="text-sm pt-2">2. Enter the 6-digit code from the app.</p>
                <div className="space-y-2">
                  <Label htmlFor="totp-code" className="sr-only">Code</Label>
                  <Input
                    id="totp-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className="font-mono tracking-widest text-center text-lg"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={cancelEnroll} disabled={verifying}>
                Cancel
              </Button>
              <Button
                onClick={verifyEnroll}
                disabled={code.length !== 6 || verifying}
                variant="success"
              >
                {verifying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Verify & enable
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={startEnroll} disabled={enrolling} variant="outline">
            {enrolling ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Shield className="w-4 h-4 mr-2" />
            )}
            Enable two-factor authentication
          </Button>
        )}
      </Card>

      <Card className="glass-card p-5 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-medium">Security activity</h3>
            <p className="text-sm text-muted-foreground">
              Review recent sign-ins, settings changes, and account events.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings/activity">View activity log</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
