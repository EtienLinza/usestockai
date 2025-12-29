import { motion, AnimatePresence } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PredictionData } from "@/pages/Dashboard";
import { CompactPredictionCard } from "./CompactPredictionCard";
import { PriceChart } from "./PriceChart";
import { 
  TrendingUp, 
  TrendingDown, 
  BarChart3, 
  Layers,
  AlertTriangle
} from "lucide-react";

interface StockComparisonViewProps {
  predictions: PredictionData[];
  onRemove: (index: number) => void;
}

export const StockComparisonView = ({ predictions, onRemove }: StockComparisonViewProps) => {
  // Find best and worst performers
  const performers = predictions.map((p, idx) => ({
    ...p,
    idx,
    changePercent: ((p.predictedPrice - p.currentPrice) / p.currentPrice) * 100
  })).sort((a, b) => b.changePercent - a.changePercent);

  const bestPerformer = performers[0];
  const worstPerformer = performers[performers.length - 1];
  const avgConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;
  const avgChange = performers.reduce((sum, p) => sum + p.changePercent, 0) / performers.length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {/* Comparison Summary */}
      <Card className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Comparison Summary</span>
          <span className="text-xs text-muted-foreground ml-auto">
            {predictions.length} stocks
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Best Performer */}
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <TrendingUp className="w-2.5 h-2.5 text-success" />
              Best Performer
            </div>
            <div className="font-mono font-medium text-primary">{bestPerformer.ticker}</div>
            <div className="text-xs text-success">
              +{bestPerformer.changePercent.toFixed(2)}%
            </div>
          </div>

          {/* Worst Performer */}
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <TrendingDown className="w-2.5 h-2.5 text-destructive" />
              Weakest
            </div>
            <div className="font-mono font-medium text-primary">{worstPerformer.ticker}</div>
            <div className={`text-xs ${worstPerformer.changePercent >= 0 ? 'text-success' : 'text-destructive'}`}>
              {worstPerformer.changePercent >= 0 ? '+' : ''}{worstPerformer.changePercent.toFixed(2)}%
            </div>
          </div>

          {/* Average Confidence */}
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Avg Confidence
            </div>
            <div className={`font-mono font-medium ${
              avgConfidence >= 70 ? 'text-success' : avgConfidence >= 50 ? 'text-warning' : 'text-destructive'
            }`}>
              {avgConfidence.toFixed(0)}%
            </div>
          </div>

          {/* Average Change */}
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Avg Predicted Change
            </div>
            <div className={`font-mono font-medium ${avgChange >= 0 ? 'text-success' : 'text-destructive'}`}>
              {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%
            </div>
          </div>
        </div>
      </Card>

      {/* Stock Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <AnimatePresence mode="popLayout">
          {predictions.map((prediction, index) => (
            <CompactPredictionCard
              key={`${prediction.ticker}-${index}`}
              data={prediction}
              onRemove={() => onRemove(index)}
              index={index}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Combined Charts */}
      <Card className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Layers className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Price Predictions Overview</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {predictions.map((prediction, index) => (
            <div key={`chart-${prediction.ticker}-${index}`} className="space-y-2">
              <div className="text-xs font-mono text-primary">{prediction.ticker}</div>
              <div className="h-48">
                <PriceChart
                  historicalData={prediction.historicalData}
                  predictedPrice={prediction.predictedPrice}
                  uncertaintyLow={prediction.uncertaintyLow}
                  uncertaintyHigh={prediction.uncertaintyHigh}
                  targetDate={prediction.targetDate}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Disclaimer */}
      <div className="flex items-start gap-3 p-4 border border-border/30 rounded-lg">
        <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Comparing multiple AI-generated predictions. Individual stock performance may vary significantly. 
          This is not financial advice.
        </p>
      </div>
    </motion.div>
  );
};
