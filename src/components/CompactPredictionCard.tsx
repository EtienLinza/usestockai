import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Gauge,
  Activity,
  X,
  Minus,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { PredictionData } from "@/pages/Dashboard";

interface CompactPredictionCardProps {
  data: PredictionData;
  onRemove: () => void;
  index: number;
}

export const CompactPredictionCard = ({ data, onRemove, index }: CompactPredictionCardProps) => {
  const priceChange = data.predictedPrice - data.currentPrice;
  const priceChangePercent = (priceChange / data.currentPrice) * 100;
  const isPositive = priceChange >= 0;

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 70) return "text-success";
    if (confidence >= 50) return "text-warning";
    return "text-destructive";
  };

  const getRegimeBadge = (regime: string) => {
    const variants: Record<string, { color: string; label: string; icon: typeof TrendingUp }> = {
      strong_bullish: { color: "text-success bg-success/10 border-success/20", label: "Bull+", icon: TrendingUp },
      bullish: { color: "text-success bg-success/10 border-success/20", label: "Bull", icon: TrendingUp },
      strong_bearish: { color: "text-destructive bg-destructive/10 border-destructive/20", label: "Bear+", icon: TrendingDown },
      bearish: { color: "text-destructive bg-destructive/10 border-destructive/20", label: "Bear", icon: TrendingDown },
      neutral: { color: "text-warning bg-warning/10 border-warning/20", label: "Neutral", icon: Minus },
      volatile: { color: "text-chart-4 bg-chart-4/10 border-chart-4/20", label: "Volatile", icon: Activity },
      event_volatility: { color: "text-destructive bg-destructive/10 border-destructive/20", label: "⚡ Event", icon: Activity },
      ranging: { color: "text-warning bg-warning/10 border-warning/20", label: "Range", icon: Minus },
      overbought: { color: "text-warning bg-warning/10 border-warning/20", label: "OB", icon: ArrowUp },
      oversold: { color: "text-chart-4 bg-chart-4/10 border-chart-4/20", label: "OS", icon: ArrowDown },
    };
    const v = variants[regime.toLowerCase()] || variants.neutral;
    const Icon = v.icon;
    return (
      <Badge variant="outline" className={`${v.color} border gap-1 text-xs px-1.5 py-0`}>
        <Icon className="w-2.5 h-2.5" />
        {v.label}
      </Badge>
    );
  };

  // Find nearest support/resistance
  const nearestSupport = data.supportLevels?.filter(s => s < data.currentPrice).sort((a, b) => b - a)[0];
  const nearestResistance = data.resistanceLevels?.filter(r => r > data.currentPrice).sort((a, b) => a - b)[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className="glass-card p-4 relative group">
        {/* Remove Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="absolute top-2 right-2 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
        >
          <X className="w-3.5 h-3.5" />
        </Button>

        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg font-mono font-medium text-primary">{data.ticker}</span>
          {getRegimeBadge(data.regime)}
        </div>

        {/* Price Grid */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Current</div>
            <div className="text-sm font-mono font-medium">${data.currentPrice.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5 flex items-center gap-1">
              <Target className="w-2.5 h-2.5" />
              Predicted
            </div>
            <div className="text-sm font-mono font-medium">${data.predictedPrice.toFixed(2)}</div>
            <div className={`flex items-center gap-0.5 text-[10px] ${isPositive ? "text-success" : "text-destructive"}`}>
              {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
              <span>{isPositive ? "+" : ""}{priceChangePercent.toFixed(2)}%</span>
            </div>
          </div>
        </div>

        {/* Metrics Row 1: Confidence & Range */}
        <div className="grid grid-cols-2 gap-3 mb-2">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5 flex items-center gap-1">
              <Gauge className="w-2.5 h-2.5" />
              Confidence
            </div>
            <div className={`text-sm font-mono font-medium ${getConfidenceColor(data.confidence)}`}>
              {data.confidence.toFixed(0)}%
            </div>
            <div className="w-full bg-muted rounded-full h-0.5 mt-1">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${data.confidence}%` }}
                transition={{ duration: 0.6, delay: index * 0.05 }}
                className={`h-full rounded-full ${
                  data.confidence >= 70 ? "bg-success" : data.confidence >= 50 ? "bg-warning" : "bg-destructive"
                }`}
              />
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5 flex items-center gap-1">
              <Activity className="w-2.5 h-2.5" />
              Range
            </div>
            <div className="text-xs font-mono text-muted-foreground">
              ${data.uncertaintyLow.toFixed(2)} - ${data.uncertaintyHigh.toFixed(2)}
            </div>
          </div>
        </div>

        {/* Metrics Row 2: Technical + Cross-Asset Quick View */}
        <div className="grid grid-cols-4 gap-2 mb-2">
          {/* Sentiment */}
          <div className="text-center">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Sent.</div>
            <div className={`text-xs font-mono ${
              data.sentimentScore > 0.1 ? "text-success" : 
              data.sentimentScore < -0.1 ? "text-destructive" : "text-muted-foreground"
            }`}>
              {data.sentimentScore > 0 ? "+" : ""}{data.sentimentScore.toFixed(2)}
            </div>
          </div>
          
          {/* Relative Strength */}
          <div className="text-center">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">vs SPY</div>
            <div className={`text-xs font-mono ${
              (data.relativeStrength ?? 0) > 0 ? "text-success" :
              (data.relativeStrength ?? 0) < 0 ? "text-destructive" : "text-muted-foreground"
            }`}>
              {data.relativeStrength != null ? `${data.relativeStrength > 0 ? '+' : ''}${data.relativeStrength}%` : '—'}
            </div>
          </div>

          {/* Beta */}
          <div className="text-center">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Beta</div>
            <div className={`text-xs font-mono ${
              (data.beta ?? 1) > 1.3 ? "text-warning" : "text-foreground"
            }`}>
              {data.beta != null ? data.beta.toFixed(1) : '—'}
            </div>
          </div>

          {/* VIX */}
          <div className="text-center">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">VIX</div>
            <div className={`text-xs font-mono ${
              (data.vixPercentile ?? 50) > 80 ? "text-destructive" :
              (data.vixPercentile ?? 50) < 20 ? "text-success" : "text-muted-foreground"
            }`}>
              {data.vixLevel != null ? `${data.vixLevel}` : '—'}
            </div>
          </div>
        </div>

        {/* Support/Resistance Quick View */}
        {(nearestSupport || nearestResistance) && (
          <div className="flex items-center gap-2 text-[9px] mb-2">
            {nearestSupport && (
              <span className="text-success flex items-center gap-0.5">
                <ArrowDown className="w-2 h-2" />
                S: ${nearestSupport.toFixed(0)}
              </span>
            )}
            {nearestResistance && (
              <span className="text-destructive flex items-center gap-0.5">
                <ArrowUp className="w-2 h-2" />
                R: ${nearestResistance.toFixed(0)}
              </span>
            )}
          </div>
        )}

        {/* Target Date */}
        <div className="pt-2 border-t border-border/30">
          <div className="text-[10px] text-muted-foreground">
            Target: {data.targetDate}
          </div>
        </div>
      </Card>
    </motion.div>
  );
};
