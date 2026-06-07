import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  ticker: string;
  decision: "BUY" | "SELL" | "HOLD";
  confidence: number;
  currentPrice?: number | null;
  suggestedStop?: number | null;
  suggestedTarget?: number | null;
  atr?: number | null;
}

const MIN_CONVICTION_DEFAULT = 70;
const DEFAULT_STARTING_NAV = 100000;
const POSITION_SIZE_PCT = 0.05; // 5% of NAV per manual entry

export const RegisterBuyDialog = ({
  ticker, decision, confidence, currentPrice,
  suggestedStop, suggestedTarget, atr,
}: Props) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isAbnormal = decision !== "BUY" || confidence < MIN_CONVICTION_DEFAULT;
  const reasons: string[] = [];
  if (decision !== "BUY") reasons.push(`AutoTrader only opens long entries on BUY signals — this signal is ${decision}.`);
  if (confidence < MIN_CONVICTION_DEFAULT) reasons.push(`Confidence ${Math.round(confidence)}% is below the AutoTrader floor of ${MIN_CONVICTION_DEFAULT}%.`);

  const handleBuy = async () => {
    if (!user) {
      toast.error("Please sign in to register a position");
      navigate("/auth");
      return;
    }
    if (!currentPrice || currentPrice <= 0) {
      toast.error("No valid price available");
      return;
    }

    setSubmitting(true);
    try {
      // Pull starting_nav for sizing (fallback to default)
      const { data: settings } = await supabase
        .from("autotrade_settings")
        .select("starting_nav")
        .eq("user_id", user.id)
        .maybeSingle();

      const nav = Number(settings?.starting_nav) || DEFAULT_STARTING_NAV;
      const targetDollars = nav * POSITION_SIZE_PCT;
      const shares = Math.max(1, Math.floor(targetDollars / currentPrice));

      const { error } = await supabase.from("virtual_positions").insert({
        user_id: user.id,
        ticker,
        entry_price: currentPrice,
        shares,
        position_type: "long",
        status: "open",
        opened_by: "manual",
        entry_conviction: Math.round(confidence),
        entry_atr: atr ?? null,
        hard_stop_price: suggestedStop ?? null,
        target_profit_pct: suggestedTarget && currentPrice
          ? ((suggestedTarget - currentPrice) / currentPrice) * 100
          : null,
      });

      if (error) {
        // P-4: friendlier message when the partial unique index blocks a duplicate open.
        if ((error as { code?: string }).code === "23505") {
          throw new Error(`You already have an open position in ${ticker}. Close it first to re-enter.`);
        }
        throw error;
      }

      toast.success(`Bought ${shares} ${ticker} @ $${currentPrice.toFixed(2)}`, {
        description: `Position registered in your virtual portfolio.`,
        action: { label: "View", onClick: () => navigate("/autotrader-log") },
      });
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to register position");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          className={cn(
            "gap-1.5",
            isAbnormal
              ? "bg-destructive/15 text-destructive border border-destructive/40 hover:bg-destructive/25"
              : "bg-success/15 text-success border border-success/40 hover:bg-success/25"
          )}
          variant="ghost"
        >
          <ShoppingCart className="w-3.5 h-3.5" />
          Register buy
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className={cn("flex items-center gap-2", isAbnormal && "text-destructive")}>
            {isAbnormal && <AlertTriangle className="w-5 h-5" />}
            {isAbnormal ? "Severe warning — outside AutoTrader rules" : `Confirm buy ${ticker}`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              {isAbnormal && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-md p-3 space-y-1.5">
                  <div className="font-semibold text-destructive">
                    The AutoTrader would NOT normally take this trade:
                  </div>
                  <ul className="list-disc list-inside text-destructive/90 space-y-1">
                    {reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                  <div className="text-xs text-muted-foreground pt-1">
                    Manual entries bypass conviction floors, regime gates, correlation gating, and Kelly sizing.
                    You take full responsibility for this trade.
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 font-mono text-xs bg-muted/30 rounded-md p-3">
                <div><span className="text-muted-foreground">Ticker:</span> {ticker}</div>
                <div><span className="text-muted-foreground">Signal:</span> {decision} ({Math.round(confidence)}%)</div>
                <div><span className="text-muted-foreground">Entry:</span> ${currentPrice?.toFixed(2) ?? "—"}</div>
                <div><span className="text-muted-foreground">Size:</span> ~{(POSITION_SIZE_PCT * 100).toFixed(0)}% NAV</div>
                <div><span className="text-muted-foreground">Stop:</span> {suggestedStop ? `$${suggestedStop.toFixed(2)}` : "—"}</div>
                <div><span className="text-muted-foreground">Target:</span> {suggestedTarget ? `$${suggestedTarget.toFixed(2)}` : "—"}</div>
              </div>
              <div className="text-xs text-muted-foreground">
                This registers a virtual position in your paper-trading portfolio. No real money is moved.
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); handleBuy(); }}
            disabled={submitting}
            className={cn(isAbnormal && "bg-destructive hover:bg-destructive/90")}
          >
            {submitting ? "Registering…" : isAbnormal ? "I understand, buy anyway" : "Confirm buy"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
