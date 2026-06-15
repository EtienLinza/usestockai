import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Tier, TIER_LABELS, TIER_FEATURE_LIST } from "@/lib/tier-features";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Icon className="w-5 h-5 text-primary" />
            <span className="text-xs uppercase tracking-wide text-primary font-medium">
              {TIER_LABELS[requiredTier]} feature
            </span>
          </div>
          <DialogTitle>{TIER_LABELS[requiredTier]} is launching soon</DialogTitle>
          <DialogDescription>
            {feature ? `${feature} is part of the ${TIER_LABELS[requiredTier]} plan.` : `This feature is part of the ${TIER_LABELS[requiredTier]} plan.`}
            {" "}Payments are paused — join the waitlist to be first in line.
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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Maybe later</Button>
          <Button onClick={() => { onOpenChange(false); navigate(`/tier/${requiredTier}`); }}>
            Join {TIER_LABELS[requiredTier]} waitlist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
