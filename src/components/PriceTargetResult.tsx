import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Target, 
  Calendar, 
  TrendingUp, 
  TrendingDown,
  Brain,
  Gauge,
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle
} from "lucide-react";
import { ShareReport } from "./ShareReport";

export interface PriceTargetData {
  ticker: string;
  currentPrice: number;
  targetPrice: number;
  estimatedDate: string;
  estimatedDateRangeLow: string;
  estimatedDateRangeHigh: string;
  probability: number;
  direction: 'up' | 'down';
  reasoning: string;
  isRealistic: boolean;
  daysToTarget: number;
}

interface PriceTargetResultProps {
  data: PriceTargetData;
}

export const PriceTargetResult = ({ data }: PriceTargetResultProps) => {
  const priceChange = data.targetPrice - data.currentPrice;
  const priceChangePercent = (priceChange / data.currentPrice) * 100;
  const isUp = data.direction === 'up';

  const getProbabilityColor = (prob: number) => {
    if (prob >= 70) return "text-success";
    if (prob >= 40) return "text-warning";
    return "text-destructive";
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  // Transform to PredictionData format for ShareReport
  const shareData = {
    ticker: data.ticker,
    targetDate: data.estimatedDate,
    currentPrice: data.currentPrice,
    predictedPrice: data.targetPrice,
    uncertaintyLow: data.currentPrice,
    uncertaintyHigh: data.targetPrice,
    confidence: data.probability,
    regime: data.isRealistic ? 'bullish' : 'neutral',
    sentimentScore: 0,
    featureImportance: [],
    historicalData: [],
    reasoning: data.reasoning,
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
            <Badge 
              variant="outline" 
              className={`gap-1.5 ${
                isUp 
                  ? "text-success bg-success/10 border-success/20" 
                  : "text-destructive bg-destructive/10 border-destructive/20"
              }`}
            >
              <Target className="w-3 h-3" />
              Price Target
            </Badge>
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Target: ${data.targetPrice.toFixed(2)}
          </p>
        </div>
        <ShareReport data={shareData} />
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

        {/* Target Price */}
        <Card className="glass-card p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-primary/5 rounded-bl-full" />
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
            <Target className="w-3 h-3" />
            Target
          </div>
          <div className="text-xl font-mono font-medium">
            ${data.targetPrice.toFixed(2)}
          </div>
          <div className={`flex items-center gap-1 text-xs mt-1 ${
            isUp ? "text-success" : "text-destructive"
          }`}>
            {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            <span>{isUp ? "+" : ""}{priceChangePercent.toFixed(2)}%</span>
          </div>
        </Card>

        {/* Probability */}
        <Card className="glass-card p-4">
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
            <Gauge className="w-3 h-3" />
            Probability
          </div>
          <div className={`text-xl font-mono font-medium ${getProbabilityColor(data.probability)}`}>
            {data.probability.toFixed(0)}%
          </div>
          <div className="w-full bg-muted rounded-full h-1 mt-2">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${data.probability}%` }}
              transition={{ duration: 0.8 }}
              className={`h-full rounded-full ${
                data.probability >= 70 ? "bg-success" : 
                data.probability >= 40 ? "bg-warning" : "bg-destructive"
              }`}
            />
          </div>
        </Card>

        {/* Days to Target */}
        <Card className="glass-card p-4">
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            Days to Target
          </div>
          <div className="text-xl font-mono font-medium">
            ~{data.daysToTarget}
          </div>
        </Card>
      </div>

      {/* Estimated Timeline */}
      <Card className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Estimated Timeline</span>
        </div>
        
        <div className="relative">
          {/* Timeline bar */}
          <div className="flex items-center gap-4 mb-4">
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">Earliest</div>
              <div className="text-sm font-mono font-medium text-success">
                {formatDate(data.estimatedDateRangeLow)}
              </div>
            </div>
            
            <div className="flex-1 relative">
              <div className="h-2 bg-gradient-to-r from-success via-primary to-warning rounded-full" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-primary rounded-full border-2 border-background shadow-lg" />
            </div>
            
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">Latest</div>
              <div className="text-sm font-mono font-medium text-warning">
                {formatDate(data.estimatedDateRangeHigh)}
              </div>
            </div>
          </div>

          {/* Most Likely */}
          <div className="text-center p-3 bg-primary/5 rounded-lg border border-primary/20">
            <div className="text-xs text-muted-foreground mb-1">Most Likely</div>
            <div className="text-lg font-mono font-medium text-primary">
              {formatDate(data.estimatedDate)}
            </div>
          </div>
        </div>
      </Card>

      {/* Realism Assessment */}
      <Card className={`glass-card p-4 border ${
        data.isRealistic 
          ? "border-success/30 bg-success/5" 
          : "border-warning/30 bg-warning/5"
      }`}>
        <div className="flex items-center gap-3">
          {data.isRealistic ? (
            <CheckCircle className="w-5 h-5 text-success" />
          ) : (
            <XCircle className="w-5 h-5 text-warning" />
          )}
          <div>
            <div className="text-sm font-medium">
              {data.isRealistic ? "Realistic Target" : "Aggressive Target"}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.isRealistic 
                ? "Based on current trends, this target is achievable within the estimated timeframe."
                : "This target requires significant price movement and may be harder to achieve."
              }
            </p>
          </div>
        </div>
      </Card>

      {/* AI Reasoning */}
      <Card className="glass-card p-6">
        <div className="flex items-center gap-2 mb-3">
          <Brain className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">AI Analysis</span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {data.reasoning}
        </p>
      </Card>

      {/* Disclaimer */}
      <div className="flex items-start gap-3 p-4 border border-border/30 rounded-lg">
        <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          This is AI-generated timeline estimation using technical analysis. 
          Price targets are not guaranteed and actual timing may vary significantly.
        </p>
      </div>
    </motion.div>
  );
};
