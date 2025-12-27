import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, addDays } from "date-fns";
import { CalendarIcon, TrendingUp, Eye, EyeOff, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface PredictionFormProps {
  onSubmit: (data: { ticker: string; targetDate: Date; newsApiKey?: string }) => void;
  isLoading: boolean;
}

export const PredictionForm = ({ onSubmit, isLoading }: PredictionFormProps) => {
  const [ticker, setTicker] = useState("");
  const [targetDate, setTargetDate] = useState<Date | undefined>(addDays(new Date(), 1));
  const [newsApiKey, setNewsApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ticker && targetDate) {
      onSubmit({ 
        ticker: ticker.toUpperCase(), 
        targetDate,
        newsApiKey: newsApiKey || undefined 
      });
    }
  };

  const popularTickers = ["AAPL", "GOOGL", "MSFT", "TSLA", "NVDA", "AMZN"];

  return (
    <Card variant="glass" className="w-full max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          Run Prediction
        </CardTitle>
        <CardDescription>
          Enter a stock ticker and target date to generate AI-powered price predictions
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Ticker Input */}
          <div className="space-y-2">
            <Label htmlFor="ticker">Stock Ticker</Label>
            <Input
              id="ticker"
              variant="glow"
              placeholder="e.g., AAPL"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              className="font-mono uppercase"
              maxLength={5}
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {popularTickers.map((t) => (
                <motion.button
                  key={t}
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setTicker(t)}
                  className={cn(
                    "px-3 py-1 text-xs font-mono rounded-full border transition-colors",
                    ticker === t
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary/50 border-border hover:border-primary/50"
                  )}
                >
                  {t}
                </motion.button>
              ))}
            </div>
          </div>

          {/* Date Picker */}
          <div className="space-y-2">
            <Label>Target Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !targetDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {targetDate ? format(targetDate, "PPP") : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={targetDate}
                  onSelect={setTargetDate}
                  disabled={(date) => date < new Date()}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* NewsAPI Key (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="newsApiKey" className="flex items-center gap-2">
              NewsAPI Key
              <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <div className="relative">
              <Input
                id="newsApiKey"
                variant="glass"
                type={showApiKey ? "text" : "password"}
                placeholder="For sentiment analysis"
                value={newsApiKey}
                onChange={(e) => setNewsApiKey(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Add your NewsAPI key to enable sentiment-enhanced predictions
            </p>
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            variant="glow"
            size="lg"
            className="w-full"
            disabled={!ticker || !targetDate || isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <TrendingUp className="w-4 h-4" />
                Generate Prediction
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
