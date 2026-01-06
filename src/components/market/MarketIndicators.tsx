import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface MarketData {
  sp500Change: number;
  nasdaqChange: number;
  dowChange: number;
  vixValue: number;
}

interface MarketIndicatorsProps {
  data: MarketData;
}

export function MarketIndicators({ data }: MarketIndicatorsProps) {
  const getChangeDisplay = (change: number) => {
    const isPositive = change >= 0;
    const Icon = change > 0.1 ? TrendingUp : change < -0.1 ? TrendingDown : Minus;
    const color = isPositive ? "text-success" : "text-destructive";
    
    return (
      <div className={`flex items-center gap-1 ${color}`}>
        <Icon className="w-4 h-4" />
        <span className="font-mono">{isPositive ? "+" : ""}{change.toFixed(2)}%</span>
      </div>
    );
  };

  const getVixStatus = (vix: number) => {
    if (vix < 15) return { label: "Low Volatility", color: "text-success" };
    if (vix < 25) return { label: "Normal", color: "text-muted-foreground" };
    if (vix < 35) return { label: "Elevated", color: "text-warning" };
    return { label: "High Fear", color: "text-destructive" };
  };

  const vixStatus = getVixStatus(data.vixValue);

  const indicators = [
    { label: "S&P 500", value: data.sp500Change },
    { label: "NASDAQ", value: data.nasdaqChange },
    { label: "DOW", value: data.dowChange },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {indicators.map((ind) => (
        <Card key={ind.label} className="glass-card p-4">
          <div className="text-xs text-muted-foreground mb-1">{ind.label}</div>
          {getChangeDisplay(ind.value)}
        </Card>
      ))}
      
      <Card className="glass-card p-4">
        <div className="text-xs text-muted-foreground mb-1">VIX</div>
        <div className="font-mono text-lg">{data.vixValue.toFixed(2)}</div>
        <div className={`text-xs ${vixStatus.color}`}>{vixStatus.label}</div>
      </Card>
    </div>
  );
}