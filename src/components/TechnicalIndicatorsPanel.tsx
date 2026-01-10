import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  TrendingUp, 
  TrendingDown, 
  BarChart3, 
  Target, 
  Layers,
  ArrowUp,
  ArrowDown,
  Minus,
  Volume2
} from "lucide-react";

interface TechnicalIndicatorsPanelProps {
  regime: string;
  regimeDescription?: string;
  regimeStrength?: number;
  sentimentScore: number;
  sentimentConfidence?: number;
  supportLevels?: number[];
  resistanceLevels?: number[];
  fibonacciTrend?: string;
  obvTrend?: string;
  currentPrice: number;
}

export const TechnicalIndicatorsPanel = ({
  regime,
  regimeDescription,
  regimeStrength,
  sentimentScore,
  sentimentConfidence,
  supportLevels = [],
  resistanceLevels = [],
  fibonacciTrend,
  obvTrend,
  currentPrice,
}: TechnicalIndicatorsPanelProps) => {
  const getRegimeConfig = (r: string) => {
    const configs: Record<string, { color: string; icon: typeof TrendingUp; label: string }> = {
      strong_bullish: { color: "text-success", icon: TrendingUp, label: "Strong Bullish" },
      bullish: { color: "text-success", icon: TrendingUp, label: "Bullish" },
      strong_bearish: { color: "text-destructive", icon: TrendingDown, label: "Strong Bearish" },
      bearish: { color: "text-destructive", icon: TrendingDown, label: "Bearish" },
      volatile: { color: "text-chart-4", icon: BarChart3, label: "Volatile" },
      ranging: { color: "text-warning", icon: Minus, label: "Ranging" },
      overbought: { color: "text-warning", icon: ArrowUp, label: "Overbought" },
      oversold: { color: "text-chart-4", icon: ArrowDown, label: "Oversold" },
      neutral: { color: "text-muted-foreground", icon: Minus, label: "Neutral" },
    };
    return configs[r.toLowerCase()] || configs.neutral;
  };

  const getOBVConfig = (trend?: string) => {
    if (trend === "rising") return { color: "text-success", icon: TrendingUp, label: "Rising" };
    if (trend === "falling") return { color: "text-destructive", icon: TrendingDown, label: "Falling" };
    return { color: "text-muted-foreground", icon: Minus, label: "Neutral" };
  };

  const getFibConfig = (trend?: string) => {
    if (trend === "uptrend") return { color: "text-success", label: "Uptrend" };
    if (trend === "downtrend") return { color: "text-destructive", label: "Downtrend" };
    return { color: "text-muted-foreground", label: "—" };
  };

  const regimeConfig = getRegimeConfig(regime);
  const obvConfig = getOBVConfig(obvTrend);
  const fibConfig = getFibConfig(fibonacciTrend);
  const RegimeIcon = regimeConfig.icon;
  const OBVIcon = obvConfig.icon;

  // Find nearest support and resistance
  const nearestSupport = supportLevels.length > 0 
    ? supportLevels.filter(s => s < currentPrice).sort((a, b) => b - a)[0]
    : null;
  const nearestResistance = resistanceLevels.length > 0
    ? resistanceLevels.filter(r => r > currentPrice).sort((a, b) => a - b)[0]
    : null;

  return (
    <Card className="glass-card p-6">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">Technical Analysis</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {/* Market Regime */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-1.5"
        >
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Market Regime</div>
          <div className={`flex items-center gap-1.5 ${regimeConfig.color}`}>
            <RegimeIcon className="w-4 h-4" />
            <span className="text-sm font-medium">{regimeConfig.label}</span>
          </div>
          {regimeStrength !== undefined && regimeStrength > 0 && (
            <div className="text-[10px] text-muted-foreground">
              Strength: {regimeStrength.toFixed(1)}
            </div>
          )}
        </motion.div>

        {/* Sentiment */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="space-y-1.5"
        >
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">News Sentiment</div>
          <div className={`flex items-center gap-1.5 ${
            sentimentScore > 0.1 ? "text-success" : 
            sentimentScore < -0.1 ? "text-destructive" : "text-muted-foreground"
          }`}>
            {sentimentScore > 0.1 ? <TrendingUp className="w-4 h-4" /> : 
             sentimentScore < -0.1 ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
            <span className="text-sm font-medium font-mono">
              {sentimentScore > 0 ? "+" : ""}{sentimentScore.toFixed(2)}
            </span>
          </div>
          {sentimentConfidence !== undefined && (
            <div className="text-[10px] text-muted-foreground">
              Confidence: {(sentimentConfidence * 100).toFixed(0)}%
            </div>
          )}
        </motion.div>

        {/* OBV Trend */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-1.5"
        >
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Volume2 className="w-2.5 h-2.5" />
            Volume (OBV)
          </div>
          <div className={`flex items-center gap-1.5 ${obvConfig.color}`}>
            <OBVIcon className="w-4 h-4" />
            <span className="text-sm font-medium">{obvConfig.label}</span>
          </div>
        </motion.div>

        {/* Fibonacci Trend */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="space-y-1.5"
        >
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Layers className="w-2.5 h-2.5" />
            Fibonacci
          </div>
          <div className={`text-sm font-medium ${fibConfig.color}`}>
            {fibConfig.label}
          </div>
        </motion.div>
      </div>

      {/* Support & Resistance */}
      {(supportLevels.length > 0 || resistanceLevels.length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-4 pt-4 border-t border-border/30"
        >
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1">
            <Target className="w-2.5 h-2.5" />
            Key Levels
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            {/* Support Levels */}
            <div className="space-y-2">
              <div className="text-xs text-success font-medium flex items-center gap-1">
                <ArrowDown className="w-3 h-3" />
                Support
              </div>
              <div className="space-y-1">
                {supportLevels.length > 0 ? (
                  supportLevels.slice(0, 3).map((level, i) => (
                    <div 
                      key={i} 
                      className={`text-xs font-mono flex items-center gap-2 ${
                        level === nearestSupport ? "text-success" : "text-muted-foreground"
                      }`}
                    >
                      <span>${level.toFixed(2)}</span>
                      {level === nearestSupport && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 text-success border-success/30">
                          Nearest
                        </Badge>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground">—</div>
                )}
              </div>
            </div>

            {/* Resistance Levels */}
            <div className="space-y-2">
              <div className="text-xs text-destructive font-medium flex items-center gap-1">
                <ArrowUp className="w-3 h-3" />
                Resistance
              </div>
              <div className="space-y-1">
                {resistanceLevels.length > 0 ? (
                  resistanceLevels.slice(0, 3).map((level, i) => (
                    <div 
                      key={i} 
                      className={`text-xs font-mono flex items-center gap-2 ${
                        level === nearestResistance ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      <span>${level.toFixed(2)}</span>
                      {level === nearestResistance && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 text-destructive border-destructive/30">
                          Nearest
                        </Badge>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground">—</div>
                )}
              </div>
            </div>
          </div>

          {/* Price Position Context */}
          {(nearestSupport || nearestResistance) && (
            <div className="mt-3 pt-3 border-t border-border/20">
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                {nearestSupport && (
                  <span>
                    <span className="text-success">{((currentPrice - nearestSupport) / nearestSupport * 100).toFixed(1)}%</span> above support
                  </span>
                )}
                {nearestResistance && (
                  <span>
                    <span className="text-destructive">{((nearestResistance - currentPrice) / currentPrice * 100).toFixed(1)}%</span> below resistance
                  </span>
                )}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Regime Description */}
      {regimeDescription && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="mt-4 pt-4 border-t border-border/30"
        >
          <p className="text-xs text-muted-foreground leading-relaxed">
            {regimeDescription}
          </p>
        </motion.div>
      )}
    </Card>
  );
};
