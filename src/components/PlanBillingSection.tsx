import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useNavigate } from "react-router-dom";
import { useTier } from "@/hooks/useTier";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { TierBadge } from "@/components/TierBadge";
import { TIER_LIMITS, TIER_PRICES, TIER_LABELS } from "@/lib/tier-features";
import { getStripeEnvironment, isPaymentsConfigured } from "@/lib/stripe";
import { Sparkles, ArrowRight, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const PlanBillingSection = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tier } = useTier();
  const [backtestsThisMonth, setBacktestsThisMonth] = useState<number>(0);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    if (!user) return;
    const monthKey = new Date().toISOString().slice(0, 7);
    supabase
      .from("usage_counters")
      .select("backtests_run")
      .eq("user_id", user.id)
      .eq("month_key", monthKey)
      .maybeSingle()
      .then(({ data }) => setBacktestsThisMonth(data?.backtests_run ?? 0));
  }, [user]);

  const limits = TIER_LIMITS[tier];
  const limit = limits.backtests_per_month;
  const limitDisplay = limit === Infinity ? "∞" : limit;
  const pct = limit === Infinity ? 0 : Math.min(100, (backtestsThisMonth / limit) * 100);
  const price = TIER_PRICES[tier].monthly;
  const isPaid = tier !== "free";

  const openBillingPortal = async () => {
    if (!isPaymentsConfigured()) {
      toast.error("Payments aren't configured for this build.");
      return;
    }
    setOpeningPortal(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-portal-session", {
        body: {
          environment: getStripeEnvironment(),
          returnUrl: `${window.location.origin}/settings`,
        },
      });
      if (error || !data?.url) throw new Error(error?.message || data?.error || "Failed to open billing portal");
      window.open(data.url as string, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open billing portal");
    } finally {
      setOpeningPortal(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-primary" />
            <h3 className="text-base font-medium">Plan & Billing</h3>
          </div>
          <p className="text-xs text-muted-foreground">Your current plan and monthly usage.</p>
        </div>
        <TierBadge tier={tier} />
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <div className="p-4 rounded-lg bg-muted/30 border border-border">
          <div className="text-xs text-muted-foreground mb-1">Current plan</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-light">{TIER_LABELS[tier]}</span>
            <span className="text-sm text-muted-foreground">${price}/mo</span>
          </div>
        </div>
        <div className="p-4 rounded-lg bg-muted/30 border border-border">
          <div className="text-xs text-muted-foreground mb-1">Backtests this month</div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-light">{backtestsThisMonth}</span>
            <span className="text-sm text-muted-foreground">/ {limitDisplay}</span>
          </div>
          {limit !== Infinity && <Progress value={pct} className="h-1" />}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => navigate("/pricing")} variant={isPaid ? "outline" : "default"}>
          {isPaid ? "Change plan" : "Upgrade plan"}
          <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
        {isPaid && (
          <Button onClick={openBillingPortal} variant="outline" disabled={openingPortal}>
            {openingPortal ? "Opening…" : "Manage billing"}
            <ExternalLink className="w-4 h-4 ml-1" />
          </Button>
        )}
      </div>
    </Card>
  );
};
