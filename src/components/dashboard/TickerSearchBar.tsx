import { useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ExternalLink, Brain, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AnalysisResultCard, type AnalysisResult } from "./AnalysisResultCard";
import { PriceAlertModal } from "@/components/PriceAlertModal";
import { useAuth } from "@/hooks/useAuth";

const TICKER_RE = /^[A-Z]{1,10}(-[A-Z]{2,4})?$/;

export const TickerSearchBar = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [alertOpen, setAlertOpen] = useState(false);

  const cleaned = value.trim().toUpperCase();
  const valid = TICKER_RE.test(cleaned);

  const handleView = () => {
    if (!valid) { toast.error("Enter a valid ticker (e.g. AAPL, BTC-USD)"); return; }
    navigate(`/stock/${encodeURIComponent(cleaned)}`);
  };

  const handleAnalyze = async () => {
    if (!valid) { toast.error("Enter a valid ticker (e.g. AAPL, BTC-USD)"); return; }
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke<AnalysisResult>("analyze-ticker", {
        body: { ticker: cleaned },
      });
      if (error) throw error;
      if (!data) throw new Error("Empty response");
      setResult(data);
    } catch (e: any) {
      console.error("analyze-ticker failed", e);
      toast.error(e?.message || "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleAnalyze();
  };

  const handleCreateAlert = async (targetPrice: number, direction: "above" | "below") => {
    if (!user || !result) { toast.error("Please sign in"); return; }
    const { error } = await supabase.from("price_alerts").insert({
      user_id: user.id, ticker: result.ticker, target_price: targetPrice, direction,
    });
    if (error) { toast.error("Failed to create alert"); throw error; }
    toast.success(`Alert set for ${result.ticker} ${direction} $${targetPrice.toFixed(2)}`);
  };

  return (
    <div className="space-y-4 mb-6">
      <Card className="glass-card p-4">
        <div className="flex items-center gap-2 mb-1">
          <Search className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-medium">Look up any ticker</span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3 leading-snug">
          Run a fresh BUY / SELL / HOLD analysis or open the full stock page.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            onKeyDown={onKeyDown}
            placeholder="e.g. AAPL, NVDA, BTC-USD"
            className="font-mono uppercase"
            maxLength={20}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleView}
              disabled={!valid || loading}
              className="gap-1.5 flex-1 sm:flex-initial"
            >
              <ExternalLink className="w-3.5 h-3.5" /> View
            </Button>
            <Button
              onClick={handleAnalyze}
              disabled={!valid || loading}
              className="gap-1.5 flex-1 sm:flex-initial"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
              Analyze
            </Button>
          </div>
        </div>
      </Card>

      {(loading || result) && (
        <AnalysisResultCard
          result={result}
          loading={loading}
          onSetAlert={result ? () => setAlertOpen(true) : undefined}
        />
      )}

      {result && (
        <PriceAlertModal
          isOpen={alertOpen}
          onClose={() => setAlertOpen(false)}
          onSubmit={handleCreateAlert}
          ticker={result.ticker}
          currentPrice={result.currentPrice ?? undefined}
        />
      )}
    </div>
  );
};
