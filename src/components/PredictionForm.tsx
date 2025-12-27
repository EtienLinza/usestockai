import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, addDays, isAfter, isBefore, addMonths } from "date-fns";
import { CalendarIcon, TrendingUp, Eye, EyeOff, Loader2, Sparkles, RefreshCw, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PredictionFormProps {
  onSubmit: (data: { ticker: string; targetDate: Date; newsApiKey?: string }) => void;
  isLoading: boolean;
  onRefresh?: () => void;
}

// Validation schemas
const TICKER_REGEX = /^[A-Z]{1,5}$/;
const API_KEY_MIN_LENGTH = 20;

export const PredictionForm = ({ onSubmit, isLoading, onRefresh }: PredictionFormProps) => {
  const [ticker, setTicker] = useState("");
  const [targetDate, setTargetDate] = useState<Date | undefined>(addDays(new Date(), 1));
  const [newsApiKey, setNewsApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  
  // Validation states
  const [errors, setErrors] = useState<{
    ticker?: string;
    date?: string;
    apiKey?: string;
  }>({});

  const validateTicker = (value: string): string | undefined => {
    if (!value) return "Ticker is required";
    if (!TICKER_REGEX.test(value.toUpperCase())) {
      return "Invalid ticker format (1-5 uppercase letters)";
    }
    return undefined;
  };

  const validateDate = (date: Date | undefined): string | undefined => {
    if (!date) return "Target date is required";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (isBefore(date, today)) {
      return "Date must be in the future";
    }
    const maxDate = addMonths(today, 12);
    if (isAfter(date, maxDate)) {
      return "Date cannot be more than 1 year in the future";
    }
    return undefined;
  };

  const validateApiKey = (value: string): string | undefined => {
    if (value && value.length < API_KEY_MIN_LENGTH) {
      return "API key seems too short";
    }
    return undefined;
  };

  const handleTickerChange = (value: string) => {
    const upperValue = value.toUpperCase();
    setTicker(upperValue);
    const error = validateTicker(upperValue);
    setErrors(prev => ({ ...prev, ticker: error }));
  };

  const handleDateChange = (date: Date | undefined) => {
    setTargetDate(date);
    const error = validateDate(date);
    setErrors(prev => ({ ...prev, date: error }));
  };

  const handleApiKeyChange = (value: string) => {
    setNewsApiKey(value);
    const error = validateApiKey(value);
    setErrors(prev => ({ ...prev, apiKey: error }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate all fields
    const tickerError = validateTicker(ticker);
    const dateError = validateDate(targetDate);
    const apiKeyError = validateApiKey(newsApiKey);
    
    setErrors({
      ticker: tickerError,
      date: dateError,
      apiKey: apiKeyError,
    });

    if (tickerError || dateError || apiKeyError) {
      toast.error("Please fix the validation errors");
      return;
    }

    if (ticker && targetDate) {
      onSubmit({ 
        ticker: ticker.toUpperCase(), 
        targetDate,
        newsApiKey: newsApiKey || undefined 
      });
    }
  };

  const popularTickers = ["AAPL", "GOOGL", "MSFT", "TSLA", "NVDA", "AMZN"];
  const isFormValid = ticker && targetDate && !errors.ticker && !errors.date && !errors.apiKey;

  return (
    <Card variant="glass" className="w-full max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Run Prediction
          </span>
          {onRefresh && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={isLoading}
              className="h-8 w-8 p-0"
            >
              <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
            </Button>
          )}
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
              onChange={(e) => handleTickerChange(e.target.value)}
              className={cn(
                "font-mono uppercase",
                errors.ticker && "border-destructive focus:ring-destructive"
              )}
              maxLength={5}
            />
            {errors.ticker && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {errors.ticker}
              </p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              {popularTickers.map((t) => (
                <motion.button
                  key={t}
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleTickerChange(t)}
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
                    !targetDate && "text-muted-foreground",
                    errors.date && "border-destructive"
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
                  onSelect={handleDateChange}
                  disabled={(date) => {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    return date < today || date > addMonths(today, 12);
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            {errors.date && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {errors.date}
              </p>
            )}
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
                onChange={(e) => handleApiKeyChange(e.target.value)}
                className={cn(
                  "pr-10",
                  errors.apiKey && "border-warning focus:ring-warning"
                )}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.apiKey ? (
              <p className="text-xs text-warning flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {errors.apiKey}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Add your NewsAPI key to enable sentiment-enhanced predictions
              </p>
            )}
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            variant="glow"
            size="lg"
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
                Generate Prediction
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};