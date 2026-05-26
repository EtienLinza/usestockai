import { Badge } from "@/components/ui/badge";
import { Tier, TIER_LABELS } from "@/lib/tier-features";
import { cn } from "@/lib/utils";
import { Crown, Sparkles } from "lucide-react";

interface Props {
  tier: Tier;
  className?: string;
}

export const TierBadge = ({ tier, className }: Props) => {
  const styles: Record<Tier, string> = {
    free: "bg-muted text-muted-foreground border-border",
    pro: "bg-primary/15 text-primary border-primary/30",
    elite: "bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-500 border-amber-500/40",
  };
  const Icon = tier === "elite" ? Crown : tier === "pro" ? Sparkles : null;
  return (
    <Badge variant="outline" className={cn("text-[10px] font-medium uppercase tracking-wide", styles[tier], className)}>
      {Icon && <Icon className="w-3 h-3 mr-1" />}
      {TIER_LABELS[tier]}
    </Badge>
  );
};
