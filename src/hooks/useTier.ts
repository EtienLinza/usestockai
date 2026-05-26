import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Tier, FeatureKey, canUseFeature, tierMeets } from "@/lib/tier-features";

interface TierState {
  tier: Tier;
  onboardingCompleted: boolean;
}

export function useTier() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<TierState>({
    queryKey: ["tier", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("subscription_tier, onboarding_completed")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return {
        tier: (data?.subscription_tier as Tier) ?? "free",
        onboardingCompleted: !!data?.onboarding_completed,
      };
    },
  });

  const tier: Tier = data?.tier ?? "free";

  return {
    tier,
    isFree: tier === "free",
    isPro: tier === "pro",
    isElite: tier === "elite",
    onboardingCompleted: data?.onboardingCompleted ?? true,
    loading: isLoading,
    canUse: (feature: FeatureKey) => canUseFeature(tier, feature),
    meets: (required: Tier) => tierMeets(tier, required),
    invalidate: () => qc.invalidateQueries({ queryKey: ["tier", user?.id] }),
  };
}
