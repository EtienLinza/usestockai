import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";

interface SentimentGaugeProps {
  score: number; // 0-100, where 0 = extreme fear, 100 = extreme greed
}

export function SentimentGauge({ score }: SentimentGaugeProps) {
  const getLabel = (score: number) => {
    if (score <= 20) return { text: "Extreme Fear", color: "text-destructive" };
    if (score <= 40) return { text: "Fear", color: "text-warning" };
    if (score <= 60) return { text: "Neutral", color: "text-muted-foreground" };
    if (score <= 80) return { text: "Greed", color: "text-success" };
    return { text: "Extreme Greed", color: "text-success" };
  };

  const label = getLabel(score);
  const rotation = (score / 100) * 180 - 90; // -90 to 90 degrees

  return (
    <Card className="glass-card p-6">
      <div className="text-xs text-muted-foreground mb-3">Fear & Greed Index</div>
      
      <div className="relative w-full max-w-[200px] mx-auto">
        {/* Gauge background */}
        <svg viewBox="0 0 200 110" className="w-full">
          {/* Background arc */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="12"
            strokeLinecap="round"
          />
          {/* Colored arc segments */}
          <path
            d="M 20 100 A 80 80 0 0 1 56 44"
            fill="none"
            stroke="hsl(var(--destructive))"
            strokeWidth="12"
            strokeLinecap="round"
            className="opacity-60"
          />
          <path
            d="M 56 44 A 80 80 0 0 1 100 20"
            fill="none"
            stroke="hsl(var(--warning))"
            strokeWidth="12"
            className="opacity-60"
          />
          <path
            d="M 100 20 A 80 80 0 0 1 144 44"
            fill="none"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth="12"
            className="opacity-40"
          />
          <path
            d="M 144 44 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="hsl(var(--success))"
            strokeWidth="12"
            strokeLinecap="round"
            className="opacity-60"
          />
        </svg>
        
        {/* Needle */}
        <motion.div
          className="absolute bottom-0 left-1/2 origin-bottom w-1 h-16 -ml-0.5"
          initial={{ rotate: -90 }}
          animate={{ rotate: rotation }}
          transition={{ duration: 1, ease: "easeOut" }}
        >
          <div className="w-full h-full bg-foreground rounded-full" />
        </motion.div>
        
        {/* Center circle */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-4 h-4 bg-foreground rounded-full" />
      </div>
      
      {/* Score display */}
      <div className="text-center mt-4">
        <div className="text-3xl font-mono font-medium">{score}</div>
        <div className={`text-sm font-medium ${label.color}`}>{label.text}</div>
      </div>
    </Card>
  );
}