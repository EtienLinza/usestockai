import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Wallet,
  Activity
} from "lucide-react";

interface PortfolioSummaryProps {
  totalValue: number;
  totalCost: number;
  dayChange: number;
  dayChangePercent: number;
}

export const PortfolioSummary = ({
  totalValue,
  totalCost,
  dayChange,
  dayChangePercent,
}: PortfolioSummaryProps) => {
  const totalPnL = totalValue - totalCost;
  const totalPnLPercent = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;
  const isPnLPositive = totalPnL >= 0;
  const isDayPositive = dayChange >= 0;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const stats = [
    {
      label: "Total Value",
      value: formatCurrency(totalValue),
      icon: Wallet,
      color: "text-foreground",
    },
    {
      label: "Total Cost",
      value: formatCurrency(totalCost),
      icon: DollarSign,
      color: "text-muted-foreground",
    },
    {
      label: "Total P&L",
      value: `${isPnLPositive ? "+" : ""}${formatCurrency(totalPnL)}`,
      subValue: `${isPnLPositive ? "+" : ""}${totalPnLPercent.toFixed(2)}%`,
      icon: isPnLPositive ? TrendingUp : TrendingDown,
      color: isPnLPositive ? "text-success" : "text-destructive",
    },
    {
      label: "Today",
      value: `${isDayPositive ? "+" : ""}${formatCurrency(dayChange)}`,
      subValue: `${isDayPositive ? "+" : ""}${dayChangePercent.toFixed(2)}%`,
      icon: Activity,
      color: isDayPositive ? "text-success" : "text-destructive",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat, index) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
        >
          <Card className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
              <span className="text-xs text-muted-foreground">{stat.label}</span>
            </div>
            <div className={`text-lg font-mono font-medium ${stat.color}`}>
              {stat.value}
            </div>
            {stat.subValue && (
              <div className={`text-xs font-mono ${stat.color} opacity-80`}>
                {stat.subValue}
              </div>
            )}
          </Card>
        </motion.div>
      ))}
    </div>
  );
};
