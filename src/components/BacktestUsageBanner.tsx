import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { supabase } from "@/integrations/supabase/client";
import { TierBadge } from "@/components/TierBadge";
import { TIER_LIMITS } from "@/lib/tier-features";
import { Sparkles, ArrowRight } from "lucide-react";

export const BacktestUsageBanner = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tier } = useTier();
  const [used, setUsed] = useState(0);

  useEffect(() => {
    if (!user) return;
    const monthKey = new Date().toISOString().slice(0, 7);
    supabase
      .from("usage_counters")
      .select("backtests_run")
      .eq("user_id", user.id)
      .eq("month_key", monthKey)
      .maybeSingle()
      .then(({ data }) => setUsed(data?.backtests_run ?? 0));
  }, [user]);

  const limit = TIER_LIMITS[tier].backtests_per_month;
  const limitDisplay = limit === Infinity ? "Unlimited" : limit;
  const pct = limit === Infinity ? 0 : Math.min(100, (used / limit) * 100);
  const isNearLimit = limit !== Infinity && used / limit >= 0.66;

  return (
    <Card className="p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <TierBadge tier={tier} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 text-sm">
          <span className="text-foreground font-medium">{used}</span>
          <span className="text-muted-foreground">/ {limitDisplay} backtests this month</span>
        </div>
        {limit !== Infinity && <Progress value={pct} className="h-1 mt-2" />}
      </div>
      {tier !== "elite" && (
        <Button size="sm" variant={isNearLimit ? "default" : "outline"} onClick={() => navigate("/pricing")}>
          {tier === "free" ? "Upgrade to Pro" : "Upgrade to Elite"}
          <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      )}
    </Card>
  );
};
