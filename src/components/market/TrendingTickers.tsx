import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, ChevronRight } from "lucide-react";

interface TrendingTicker {
  ticker: string;
  name: string;
  change: number;
  volume: number;
}

interface TrendingTickersProps {
  gainers: TrendingTicker[];
  losers: TrendingTicker[];
}

export function TrendingTickers({ gainers, losers }: TrendingTickersProps) {
  const navigate = useNavigate();

  const formatVolume = (vol: number) => {
    if (vol >= 1e9) return `${(vol / 1e9).toFixed(1)}B`;
    if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)}M`;
    return `${(vol / 1e3).toFixed(0)}K`;
  };

  const TickerRow = ({ ticker }: { ticker: TrendingTicker }) => {
    const isPositive = ticker.change >= 0;
    
    return (
      <div 
        className="flex items-center justify-between py-2 px-1 hover:bg-primary/5 rounded cursor-pointer transition-colors group"
        onClick={() => navigate(`/dashboard?ticker=${ticker.ticker}`)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center">
            {isPositive ? (
              <TrendingUp className="w-4 h-4 text-success" />
            ) : (
              <TrendingDown className="w-4 h-4 text-destructive" />
            )}
          </div>
          <div>
            <div className="font-mono text-sm font-medium text-primary">{ticker.ticker}</div>
            <div className="text-xs text-muted-foreground truncate max-w-[120px]">{ticker.name}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className={`font-mono text-sm ${isPositive ? "text-success" : "text-destructive"}`}>
              {isPositive ? "+" : ""}{ticker.change.toFixed(2)}%
            </div>
            <div className="text-xs text-muted-foreground">Vol: {formatVolume(ticker.volume)}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    );
  };

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card className="glass-card p-4">
        <div className="flex items-center gap-2 mb-4">
          <Badge className="bg-success/20 text-success border-success/30">
            <TrendingUp className="w-3 h-3 mr-1" />
            Top Gainers
          </Badge>
        </div>
        <div className="space-y-1">
          {gainers.slice(0, 5).map((ticker) => (
            <TickerRow key={ticker.ticker} ticker={ticker} />
          ))}
        </div>
      </Card>

      <Card className="glass-card p-4">
        <div className="flex items-center gap-2 mb-4">
          <Badge className="bg-destructive/20 text-destructive border-destructive/30">
            <TrendingDown className="w-3 h-3 mr-1" />
            Top Losers
          </Badge>
        </div>
        <div className="space-y-1">
          {losers.slice(0, 5).map((ticker) => (
            <TickerRow key={ticker.ticker} ticker={ticker} />
          ))}
        </div>
      </Card>
    </div>
  );
}