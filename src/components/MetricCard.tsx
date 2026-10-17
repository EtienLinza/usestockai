import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  suffix?: string;
  icon: React.ElementType;
  color?: string;
  subtext?: string;
}

export const MetricCard = ({ label, value, suffix = "", icon: Icon, color = "text-foreground", subtext }: MetricCardProps) => (
  <Card className="glass-card p-3 sm:p-4 min-w-0 group">
    <div className="text-xs text-muted-foreground mb-2 flex items-start gap-2">
      <Icon aria-hidden="true" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span className="break-words">{label}</span>
    </div>
    <div className={cn("text-lg sm:text-xl font-mono font-medium tabular-nums break-words", color)}>
      {value}{suffix}
    </div>
    {subtext && (
      <div className="text-xs text-muted-foreground mt-1.5 break-words">{subtext}</div>
    )}
  </Card>
);
