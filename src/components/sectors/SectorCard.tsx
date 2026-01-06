import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { motion } from "framer-motion";

interface SectorCardProps {
  sector: string;
  etfTicker: string;
  dailyChange: number;
  weeklyChange: number;
  monthlyChange: number;
}

export function SectorCard({ sector, etfTicker, dailyChange, weeklyChange, monthlyChange }: SectorCardProps) {
  const getChangeColor = (change: number) => {
    if (change > 0) return "text-success";
    if (change < 0) return "text-destructive";
    return "text-muted-foreground";
  };

  const getIcon = (change: number) => {
    if (change > 0.1) return TrendingUp;
    if (change < -0.1) return TrendingDown;
    return Minus;
  };

  const DailyIcon = getIcon(dailyChange);

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="glass-card p-4 hover:border-primary/30 transition-colors">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-medium text-sm">{sector}</h3>
            <span className="text-xs text-muted-foreground font-mono">{etfTicker}</span>
          </div>
          <div className={`flex items-center gap-1 ${getChangeColor(dailyChange)}`}>
            <DailyIcon className="w-4 h-4" />
            <span className="font-mono text-sm font-medium">
              {dailyChange > 0 ? "+" : ""}{dailyChange.toFixed(2)}%
            </span>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground">Weekly</div>
            <div className={`font-mono ${getChangeColor(weeklyChange)}`}>
              {weeklyChange > 0 ? "+" : ""}{weeklyChange.toFixed(2)}%
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Monthly</div>
            <div className={`font-mono ${getChangeColor(monthlyChange)}`}>
              {monthlyChange > 0 ? "+" : ""}{monthlyChange.toFixed(2)}%
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}