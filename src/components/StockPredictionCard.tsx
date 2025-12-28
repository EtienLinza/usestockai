import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Activity, 
  Brain,
  Gauge,
  AlertTriangle,
  Minus
} from "lucide-react";
import { PriceChart } from "./PriceChart";
import { ShareReport } from "./ShareReport";
import { PredictionData } from "@/pages/Dashboard";

interface StockPredictionCardProps {
  data: PredictionData;
}

export const StockPredictionCard = ({ data }: StockPredictionCardProps) => {
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
      bullish: { color: "text-success bg-success/10 border-success/20", label: "Bullish", icon: TrendingUp },
      bearish: { color: "text-destructive bg-destructive/10 border-destructive/20", label: "Bearish", icon: TrendingDown },
      neutral: { color: "text-warning bg-warning/10 border-warning/20", label: "Neutral", icon: Minus },
      volatile: { color: "text-chart-4 bg-chart-4/10 border-chart-4/20", label: "Volatile", icon: Activity },
    };
    const v = variants[regime.toLowerCase()] || variants.neutral;
    const Icon = v.icon;
    return (
      <Badge variant="outline" className={`${v.color} border gap-1.5`}>
        <Icon className="w-3 h-3" />
        {v.label}
      </Badge>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-medium flex items-center gap-3">
            <span className="font-mono text-primary">{data.ticker}</span>
            {getRegimeBadge(data.regime)}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Target: {data.targetDate}</p>
        </div>
        <ShareReport data={data} />
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Current Price */}
        <Card className="glass-card p-4">
          <div className="text-xs text-muted-foreground mb-1">Current</div>
          <div className="text-xl font-mono font-medium">
            ${data.currentPrice.toFixed(2)}
          </div>
        </Card>

        {/* Predicted Price */}
        <Card className="glass-card p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-primary/5 rounded-bl-full" />
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
            <Target className="w-3 h-3" />
            Predicted
          </div>
          <div className="text-xl font-mono font-medium">
            ${data.predictedPrice.toFixed(2)}
          </div>
          <div className={`flex items-center gap-1 text-xs mt-1 ${isPositive ? "text-success" : "text-destructive"}`}>
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            <span>{isPositive ? "+" : ""}{priceChangePercent.toFixed(2)}%</span>
          </div>
        </Card>

        {/* Confidence */}
        <Card className="glass-card p-4">
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
            <Gauge className="w-3 h-3" />
            Confidence
          </div>
          <div className={`text-xl font-mono font-medium ${getConfidenceColor(data.confidence)}`}>
            {data.confidence.toFixed(0)}%
          </div>
          <div className="w-full bg-muted rounded-full h-1 mt-2">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${data.confidence}%` }}
              transition={{ duration: 0.8 }}
              className={`h-full rounded-full ${
                data.confidence >= 70 ? "bg-success" : data.confidence >= 50 ? "bg-warning" : "bg-destructive"
              }`}
            />
          </div>
        </Card>

        {/* Uncertainty */}
        <Card className="glass-card p-4">
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
            <Activity className="w-3 h-3" />
            Range
          </div>
          <div className="text-sm font-mono font-medium">
            ${data.uncertaintyLow.toFixed(2)}
          </div>
          <div className="text-sm font-mono font-medium text-muted-foreground">
            ${data.uncertaintyHigh.toFixed(2)}
          </div>
        </Card>
      </div>

      {/* Additional Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* Sentiment */}
        <Card className="glass-card p-4">
          <div className="text-xs text-muted-foreground mb-1">Sentiment</div>
          <div className={`text-lg font-mono font-medium ${
            data.sentimentScore > 0 ? "text-success" : 
            data.sentimentScore < 0 ? "text-destructive" : "text-muted-foreground"
          }`}>
            {data.sentimentScore > 0 ? "+" : ""}{data.sentimentScore.toFixed(2)}
          </div>
        </Card>

        {/* Volatility */}
        <Card className="glass-card p-4">
          <div className="text-xs text-muted-foreground mb-1">Volatility</div>
          <div className="text-lg font-mono font-medium">
            {data.volatility ? `${(data.volatility * 100).toFixed(1)}%` : "—"}
          </div>
        </Card>

        {/* Regime */}
        <Card className="glass-card p-4">
          <div className="text-xs text-muted-foreground mb-1">Market Regime</div>
          <div className="text-lg font-medium capitalize">
            {data.regime}
          </div>
        </Card>
      </div>

      {/* Chart */}
      <Card className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-primary" />
          <span className="text-sm font-medium">Price History & Prediction</span>
        </div>
        <PriceChart
          historicalData={data.historicalData}
          predictedPrice={data.predictedPrice}
          uncertaintyLow={data.uncertaintyLow}
          uncertaintyHigh={data.uncertaintyHigh}
          targetDate={data.targetDate}
        />
      </Card>

      {/* AI Reasoning */}
      {data.reasoning && (
        <Card className="glass-card p-6">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">AI Analysis</span>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {data.reasoning}
          </p>
        </Card>
      )}

      {/* Feature Importance */}
      {data.featureImportance && data.featureImportance.length > 0 && (
        <Card className="glass-card p-6">
          <div className="text-sm font-medium mb-4">Key Factors</div>
          <div className="space-y-3">
            {data.featureImportance.slice(0, 5).map((feature, index) => {
              const maxImportance = Math.max(...data.featureImportance.map(f => f.importance));
              const percentage = (feature.importance / maxImportance) * 100;
              
              return (
                <motion.div
                  key={feature.name}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="space-y-1"
                >
                  <div className="flex justify-between text-xs">
                    <span className="text-foreground">{feature.name}</span>
                    <span className="text-muted-foreground font-mono">
                      {(feature.importance * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${percentage}%` }}
                      transition={{ duration: 0.6, delay: index * 0.1 }}
                      className="h-full rounded-full bg-primary"
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Disclaimer */}
      <div className="flex items-start gap-3 p-4 border border-border/30 rounded-lg">
        <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          This is AI-generated analysis using real market data. 
          Not financial advice. Do not use for actual trading decisions.
        </p>
      </div>
    </motion.div>
  );
};