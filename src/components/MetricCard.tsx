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
  <Card className="glass-card p-3 sm:p-4 min-w-0">
    <div className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1 truncate">
      <Icon className="w-2.5 h-2.5 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
    <div className={cn("text-base sm:text-lg font-mono font-medium truncate", color)}>
      {value}{suffix}
    </div>
    {subtext && (
      <div className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5 truncate">{subtext}</div>
    )}
  </Card>
);
