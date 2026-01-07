import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, addDays, addMonths } from "date-fns";
import { CalendarIcon, TrendingUp, Loader2, Target, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type PredictionMode = 'date' | 'price';

interface PredictionFormProps {
  onSubmit: (data: { ticker: string; targetDate?: Date; targetPrice?: number; mode: PredictionMode }) => void;
  isLoading: boolean;
  initialTicker?: string;
}

// Supports both stocks (AAPL) and crypto (BTC-USD) formats
const TICKER_REGEX = /^[A-Z]{1,10}(-[A-Z]{2,4})?$/;

export const PredictionForm = ({ onSubmit, isLoading, initialTicker }: PredictionFormProps) => {
  const [ticker, setTicker] = useState(initialTicker || "");
  const [targetDate, setTargetDate] = useState<Date | undefined>(addDays(new Date(), 1));
  const [targetPrice, setTargetPrice] = useState<string>("");
  const [mode, setMode] = useState<PredictionMode>('date');

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

    if (mode === 'date') {
      if (!targetDate) {
        toast.error("Select a target date");
        return;
      }
      onSubmit({ ticker, targetDate, mode: 'date' });
    } else {
      const priceNum = parseFloat(targetPrice);
      if (isNaN(priceNum) || priceNum <= 0) {
        toast.error("Enter a valid target price");
        return;
      }
      onSubmit({ ticker, targetPrice: priceNum, mode: 'price' });
    }
  };

  const popularTickers = ["AAPL", "TSLA", "NVDA", "BTC-USD", "ETH-USD"];
  const isFormValid = ticker && TICKER_REGEX.test(ticker) && (
    mode === 'date' ? !!targetDate : parseFloat(targetPrice) > 0
  );

  return (
    <Card className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">Analyze Stock</h3>
      </div>

      {/* Mode Toggle */}
      <Tabs value={mode} onValueChange={(v) => setMode(v as PredictionMode)} className="mb-5">
        <TabsList className="grid w-full grid-cols-2 h-9">
          <TabsTrigger value="date" className="text-xs gap-1.5">
            <CalendarIcon className="w-3 h-3" />
            By Date
          </TabsTrigger>
          <TabsTrigger value="price" className="text-xs gap-1.5">
            <Target className="w-3 h-3" />
            By Price
          </TabsTrigger>
        </TabsList>
      </Tabs>

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

        {/* Date Picker (Date Mode) */}
        {mode === 'date' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2"
          >
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
            <p className="text-[10px] text-muted-foreground/60">
              Predict the price at a specific future date
            </p>
          </motion.div>
        )}

        {/* Target Price Input (Price Mode) */}
        {mode === 'price' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2"
          >
            <Label htmlFor="targetPrice" className="text-xs text-muted-foreground">
              Target Price
            </Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="targetPrice"
                type="number"
                placeholder="250.00"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                className="pl-9 font-mono bg-secondary/50 border-border/50 focus:border-primary/50"
                min="0"
                step="0.01"
              />
            </div>
            <p className="text-[10px] text-muted-foreground/60">
              Estimate when the stock might reach this price
            </p>
          </motion.div>
        )}

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
          ) : mode === 'date' ? (
            <>
              <TrendingUp className="w-4 h-4" />
              Predict Price
            </>
          ) : (
            <>
              <Target className="w-4 h-4" />
              Estimate Timeline
            </>
          )}
        </Button>
      </form>
    </Card>
  );
};
