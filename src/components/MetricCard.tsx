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
    <div className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5 truncate">
      <Icon className="w-2.5 h-2.5 shrink-0 transition-colors group-hover:text-primary" />
      <span className="truncate">{label}</span>
    </div>
    <div className={cn("text-base sm:text-lg font-mono font-medium tabular-nums truncate", color)}>
      {value}{suffix}
    </div>
    {subtext && (
      <div className="text-[9px] sm:text-[10px] text-muted-foreground mt-1 truncate">{subtext}</div>
    )}
  </Card>
);
