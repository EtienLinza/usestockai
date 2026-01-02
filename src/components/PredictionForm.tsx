import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, addDays, addMonths } from "date-fns";
import { CalendarIcon, TrendingUp, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PredictionFormProps {
  onSubmit: (data: { ticker: string; targetDate: Date }) => void;
  isLoading: boolean;
  onRefresh?: () => void;
  initialTicker?: string;
}

// Supports both stocks (AAPL) and crypto (BTC-USD) formats
const TICKER_REGEX = /^[A-Z]{1,10}(-[A-Z]{2,4})?$/;

export const PredictionForm = ({ onSubmit, isLoading, onRefresh, initialTicker }: PredictionFormProps) => {
  const [ticker, setTicker] = useState(initialTicker || "");
  const [targetDate, setTargetDate] = useState<Date | undefined>(addDays(new Date(), 1));

  // Update ticker when initialTicker changes
  useEffect(() => {
    if (initialTicker) {
      setTicker(initialTicker);
    }
  }, [initialTicker]);

  const handleTickerChange = (value: string) => {
    setTicker(value.toUpperCase());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!ticker || !TICKER_REGEX.test(ticker)) {
      toast.error("Enter a valid ticker (e.g., AAPL or BTC-USD)");
      return;
    }

    if (!targetDate) {
      toast.error("Select a target date");
      return;
    }

    onSubmit({ 
      ticker, 
      targetDate
    });
  };

  const popularTickers = ["AAPL", "TSLA", "NVDA", "BTC-USD", "ETH-USD"];
  const isFormValid = ticker && TICKER_REGEX.test(ticker) && targetDate;

  return (
    <Card className="glass-card p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-sm font-medium">Analyze Stock</h3>
        {onRefresh && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            className="h-8 w-8 p-0 text-muted-foreground"
          >
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          </Button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Ticker Input */}
        <div className="space-y-2">
          <Label htmlFor="ticker" className="text-xs text-muted-foreground">
            Stock Ticker
          </Label>
          <Input
            id="ticker"
            placeholder="AAPL or BTC-USD"
            value={ticker}
            onChange={(e) => handleTickerChange(e.target.value)}
            className="font-mono uppercase bg-secondary/50 border-border/50 focus:border-primary/50"
            maxLength={10}
          />
          <p className="text-xs text-muted-foreground/60 mt-1">
            Use -USD suffix for crypto (e.g., BTC-USD, ETH-USD)
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {popularTickers.map((t) => (
              <motion.button
                key={t}
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleTickerChange(t)}
                className={cn(
                  "px-3 py-1 text-xs font-mono rounded border transition-all duration-200",
                  ticker === t
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/30 border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                )}
              >
                {t}
              </motion.button>
            ))}
          </div>
        </div>

        {/* Date Picker */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Target Date</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal bg-secondary/50 border-border/50",
                  !targetDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                {targetDate ? format(targetDate, "MMM d, yyyy") : "Select date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={targetDate}
                onSelect={setTargetDate}
                disabled={(date) => {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  return date < today || date > addMonths(today, 12);
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          variant="glow"
          className="w-full"
          disabled={!isFormValid || isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <TrendingUp className="w-4 h-4" />
              Analyze
            </>
          )}
        </Button>
      </form>
    </Card>
  );
};
