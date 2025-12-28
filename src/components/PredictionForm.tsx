import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, addDays, isAfter, isBefore, addMonths } from "date-fns";
import { CalendarIcon, TrendingUp, Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PredictionFormProps {
  onSubmit: (data: { ticker: string; targetDate: Date; newsApiKey?: string }) => void;
  isLoading: boolean;
  onRefresh?: () => void;
}

const TICKER_REGEX = /^[A-Z]{1,5}$/;

export const PredictionForm = ({ onSubmit, isLoading, onRefresh }: PredictionFormProps) => {
  const [ticker, setTicker] = useState("");
  const [targetDate, setTargetDate] = useState<Date | undefined>(addDays(new Date(), 1));
  const [newsApiKey, setNewsApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  const handleTickerChange = (value: string) => {
    setTicker(value.toUpperCase());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!ticker || !TICKER_REGEX.test(ticker)) {
      toast.error("Enter a valid ticker (1-5 letters)");
      return;
    }

    if (!targetDate) {
      toast.error("Select a target date");
      return;
    }

    onSubmit({ 
      ticker, 
      targetDate,
      newsApiKey: newsApiKey || undefined 
    });
  };

  const popularTickers = ["AAPL", "GOOGL", "MSFT", "TSLA", "NVDA"];
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
            placeholder="AAPL"
            value={ticker}
            onChange={(e) => handleTickerChange(e.target.value)}
            className="font-mono uppercase bg-secondary/50 border-border/50 focus:border-primary/50"
            maxLength={5}
          />
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

        {/* NewsAPI Key (Optional) */}
        <div className="space-y-2">
          <Label htmlFor="newsApiKey" className="text-xs text-muted-foreground flex items-center gap-2">
            NewsAPI Key
            <span className="text-muted-foreground/60">(optional)</span>
          </Label>
          <div className="relative">
            <Input
              id="newsApiKey"
              type={showApiKey ? "text" : "password"}
              placeholder="For sentiment analysis"
              value={newsApiKey}
              onChange={(e) => setNewsApiKey(e.target.value)}
              className="pr-10 bg-secondary/50 border-border/50"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
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