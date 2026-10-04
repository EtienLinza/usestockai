import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { PAYMENTS_ENABLED, WINBACK_DISMISS_KEY } from "@/lib/paywall";
import { TIER_LABELS, Tier } from "@/lib/tier-features";
import { winbackState } from "@/lib/winback";
import { track } from "@/lib/analytics";

function hoursLeft(expiresAt: number) {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 3_600_000));
}

export function WinbackBanner() {
  const { user } = useAuth();
  const { tier, loading } = useTier();
  const navigate = useNavigate();
  const [offer, setOffer] = useState<{ tier: Exclude<Tier, "free">; expiresAt: number } | null>(null);

  useEffect(() => {
    if (!user || loading || tier !== "free") return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("paywall_dismissed_at, winback_shown_at, paywall_recommended_tier")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      let dismissedLocally = false;
      try { dismissedLocally = localStorage.getItem(`${WINBACK_DISMISS_KEY}:${user.id}`) === "1"; } catch { /* ignore */ }
      const s = winbackState({
        tier,
        paywallDismissedAt: data.paywall_dismissed_at,
        winbackShownAt: data.winback_shown_at,
        dismissedLocally,
        now: Date.now(),
      });
      if (!s.show || !s.expiresAt) return;
      const rec = data.paywall_recommended_tier === "elite" ? "elite" : "pro";
      setOffer({ tier: rec, expiresAt: s.expiresAt });
      if (s.firstShow) {
        await supabase.from("profiles").update({ winback_shown_at: new Date().toISOString() }).eq("user_id", user.id);
        track("winback_shown", { tier: rec });
      }
    })();
    return () => { cancelled = true; };
  }, [user, tier, loading]);

  if (!offer || !user) return null;

  const close = (clicked: boolean) => {
    try { localStorage.setItem(`${WINBACK_DISMISS_KEY}:${user.id}`, "1"); } catch { /* ignore */ }
    track(clicked ? "winback_clicked" : "winback_dismissed", { tier: offer.tier });
    setOffer(null);
    if (clicked) navigate(PAYMENTS_ENABLED ? "/pricing" : `/tier/${offer.tier}`);
  };

  const label = TIER_LABELS[offer.tier];
  return (
    <div role="region" aria-label="Special offer" className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-4 flex items-start sm:items-center gap-3 flex-col sm:flex-row">
      <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5 sm:mt-0" />
      <p className="text-sm flex-1">
        Your calibration is still saved.{" "}
        {PAYMENTS_ENABLED
          ? <>Get {label} for <span className="font-medium">$19 your first month</span></>
          : <>Join the {label} waitlist and lock in <span className="font-medium">$19 for your first month</span></>}
        {" "}— expires in {hoursLeft(offer.expiresAt)}h.
      </p>
      <div className="flex items-center gap-2 self-end sm:self-auto">
        <Button size="sm" onClick={() => close(true)}>
          {PAYMENTS_ENABLED ? `Get ${label}` : "Claim offer"}
        </Button>
        <Button size="icon" variant="ghost" aria-label="Dismiss offer" onClick={() => close(false)}>
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
