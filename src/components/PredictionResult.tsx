import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Activity, 
  Brain,
  BarChart3,
  Gauge,
  AlertTriangle
} from "lucide-react";
import { PriceChart } from "./PriceChart";
import { FeatureImportance } from "./FeatureImportance";
import { ShareReport } from "./ShareReport";

export interface PredictionData {
  ticker: string;
  targetDate: string;
  currentPrice: number;
  predictedPrice: number;
  uncertaintyLow: number;
  uncertaintyHigh: number;
  confidence: number;
  regime: string;
  sentimentScore: number;
  featureImportance: { name: string; importance: number }[];
  historicalData: { date: string; price: number }[];
}

interface PredictionResultProps {
  data: PredictionData;
}

export const PredictionResult = ({ data }: PredictionResultProps) => {
  const priceChange = data.predictedPrice - data.currentPrice;
  const priceChangePercent = (priceChange / data.currentPrice) * 100;
  const isPositive = priceChange >= 0;

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 75) return "text-success";
    if (confidence >= 50) return "text-warning";
    return "text-destructive";
  };

  const getRegimeBadge = (regime: string) => {
    const variants: Record<string, { color: string; label: string }> = {
      bullish: { color: "bg-success/20 text-success border-success/30", label: "Bullish" },
      bearish: { color: "bg-destructive/20 text-destructive border-destructive/30", label: "Bearish" },
      neutral: { color: "bg-warning/20 text-warning border-warning/30", label: "Neutral" },
      volatile: { color: "bg-chart-4/20 text-chart-4 border-chart-4/30", label: "Volatile" },
    };
    const v = variants[regime.toLowerCase()] || variants.neutral;
    return (
      <Badge variant="outline" className={`${v.color} border`}>
        {v.label}
      </Badge>
    );
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="w-full space-y-6"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <span className="font-mono text-primary">{data.ticker}</span>
            <span className="text-muted-foreground font-normal text-lg">Prediction</span>
          </h2>
          <p className="text-muted-foreground text-sm">Target: {data.targetDate}</p>
        </div>
        <div className="flex items-center gap-2">
          {getRegimeBadge(data.regime)}
          <ShareReport data={data} />
        </div>
      </motion.div>

      {/* Main Stats */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Predicted Price */}
        <Card variant="stat" className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-primary/10 to-transparent rounded-bl-full" />
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Target className="w-4 h-4" />
              Predicted Price
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">
              ${data.predictedPrice.toFixed(2)}
            </div>
            <div className={`flex items-center gap-1 text-sm mt-1 ${isPositive ? "text-success" : "text-destructive"}`}>
              {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              <span>{isPositive ? "+" : ""}{priceChange.toFixed(2)} ({priceChangePercent.toFixed(2)}%)</span>
            </div>
          </CardContent>
        </Card>

        {/* Uncertainty Range */}
        <Card variant="stat" className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-warning/10 to-transparent rounded-bl-full" />
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Uncertainty Range
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              ${data.uncertaintyLow.toFixed(2)} - ${data.uncertaintyHigh.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              ±${((data.uncertaintyHigh - data.uncertaintyLow) / 2).toFixed(2)} variance
            </div>
          </CardContent>
        </Card>

        {/* Confidence */}
        <Card variant="stat" className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-success/10 to-transparent rounded-bl-full" />
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Gauge className="w-4 h-4" />
              Model Confidence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold font-mono ${getConfidenceColor(data.confidence)}`}>
              {data.confidence.toFixed(1)}%
            </div>
            <div className="w-full bg-muted rounded-full h-2 mt-2">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${data.confidence}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
                className={`h-full rounded-full ${
                  data.confidence >= 75 ? "bg-success" : data.confidence >= 50 ? "bg-warning" : "bg-destructive"
                }`}
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Chart */}
      <motion.div variants={itemVariants}>
        <Card variant="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              Price History & Prediction
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PriceChart
              historicalData={data.historicalData}
              predictedPrice={data.predictedPrice}
              uncertaintyLow={data.uncertaintyLow}
              uncertaintyHigh={data.uncertaintyHigh}
              targetDate={data.targetDate}
            />
          </CardContent>
        </Card>
      </motion.div>

      {/* Explainability */}
      <motion.div variants={itemVariants}>
        <Card variant="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              Model Explainability
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FeatureImportance features={data.featureImportance} />
            
            {/* Additional Insights */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border">
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Market Regime</h4>
                <p className="text-sm">
                  The HMM model detected a <span className="font-semibold text-primary">{data.regime}</span> regime 
                  based on recent price patterns and volatility clusters.
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Sentiment Analysis</h4>
                <p className="text-sm">
                  News sentiment score: <span className={`font-mono font-semibold ${data.sentimentScore > 0 ? "text-success" : data.sentimentScore < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {data.sentimentScore > 0 ? "+" : ""}{data.sentimentScore.toFixed(2)}
                  </span>
                  {!data.sentimentScore && " (No NewsAPI key provided)"}
                </p>
              </div>
            </div>

            {/* Disclaimer */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20 mt-4">
              <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-warning">Disclaimer:</span> This is a simulated prediction for demonstration purposes. 
                Do not use for actual trading decisions. Past performance does not guarantee future results.
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
};