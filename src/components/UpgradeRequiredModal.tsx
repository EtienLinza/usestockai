import { useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Tier, TIER_LABELS, TIER_FEATURE_LIST } from "@/lib/tier-features";
import { PAYMENTS_ENABLED } from "@/lib/paywall";
import { track } from "@/lib/analytics";
import { Check, Sparkles, Crown } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requiredTier: Tier;
  feature?: string;
}

export const UpgradeRequiredModal = ({ open, onOpenChange, requiredTier, feature }: Props) => {
  const navigate = useNavigate();
  const Icon = requiredTier === "elite" ? Crown : Sparkles;
  const label = TIER_LABELS[requiredTier];

  useEffect(() => {
    if (open) track("feature_gate_hit", { feature: feature ?? "unknown", tier_required: requiredTier });
  }, [open, feature, requiredTier]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Icon className="w-5 h-5 text-primary" />
            <span className="text-xs uppercase tracking-wide text-primary font-medium">{label}</span>
          </div>
          <DialogTitle>{feature ? `${label} unlocks ${feature.toLowerCase()}` : `Unlock this with ${label}`}</DialogTitle>
          <DialogDescription>
            Everything you have on Free stays free.
            {PAYMENTS_ENABLED ? "" : ` ${label} opens soon — join the list to be first in line.`}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 my-2">
          {TIER_FEATURE_LIST[requiredTier].slice(0, 5).map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm">
              <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <span className="text-muted-foreground">{f}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Not now</Button>
          <Button onClick={() => { onOpenChange(false); navigate(PAYMENTS_ENABLED ? "/pricing" : `/tier/${requiredTier}`); }}>
            {PAYMENTS_ENABLED ? `Upgrade to ${label}` : `Join ${label} list`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
