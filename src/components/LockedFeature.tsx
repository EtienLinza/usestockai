import { ReactNode, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tier, TIER_LABELS } from "@/lib/tier-features";
import { useTier } from "@/hooks/useTier";
import { UpgradeRequiredModal } from "@/components/UpgradeRequiredModal";

interface Props {
  requiredTier: Tier;
  feature?: string;
  children: ReactNode;
  blur?: boolean;
}

export const LockedFeature = ({ requiredTier, feature, children, blur = true }: Props) => {
  const { meets, loading } = useTier();
  const [open, setOpen] = useState(false);

  if (loading || meets(requiredTier)) return <>{children}</>;

  return (
    <>
      <div className="relative">
        <div className={blur ? "pointer-events-none select-none blur-sm opacity-60" : "pointer-events-none select-none opacity-40"}>
          {children}
        </div>
        <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-[2px] rounded-lg">
          <div className="text-center space-y-3 p-6 max-w-sm">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 border border-primary/30">
              <Lock className="w-4 h-4 text-primary" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-primary font-medium mb-1">
                {TIER_LABELS[requiredTier]} feature
              </div>
              <p className="text-sm text-muted-foreground">
                {feature ?? "This area"} is available on the {TIER_LABELS[requiredTier]} plan.
              </p>
            </div>
            <Button size="sm" onClick={() => setOpen(true)}>Upgrade to {TIER_LABELS[requiredTier]}</Button>
          </div>
        </div>
      </div>
      <UpgradeRequiredModal open={open} onOpenChange={setOpen} requiredTier={requiredTier} feature={feature} />
    </>
  );
};
