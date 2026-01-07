import { useState } from "react";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface AddHoldingModalProps {
  onAdd: (holding: { ticker: string; shares: number; averageCost: number }) => Promise<void>;
}

const TICKER_REGEX = /^[A-Z]{1,10}(-[A-Z]{2,4})?$/;

export const AddHoldingModal = ({ onAdd }: AddHoldingModalProps) => {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [averageCost, setAverageCost] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const tickerUpper = ticker.toUpperCase();
    if (!TICKER_REGEX.test(tickerUpper)) {
      toast.error("Enter a valid ticker (e.g., AAPL or BTC-USD)");
      return;
    }

    const sharesNum = parseFloat(shares);
    if (isNaN(sharesNum) || sharesNum <= 0) {
      toast.error("Enter a valid number of shares");
      return;
    }

    const costNum = parseFloat(averageCost);
    if (isNaN(costNum) || costNum <= 0) {
      toast.error("Enter a valid average cost");
      return;
    }

    setIsLoading(true);
    try {
      await onAdd({
        ticker: tickerUpper,
        shares: sharesNum,
        averageCost: costNum,
      });
      setOpen(false);
      setTicker("");
      setShares("");
      setAverageCost("");
      toast.success(`${tickerUpper} added to portfolio`);
    } catch (error) {
      toast.error("Failed to add holding");
    } finally {
      setIsLoading(false);
    }
  };

  const popularTickers = ["AAPL", "TSLA", "NVDA", "MSFT", "GOOGL"];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="glow" size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          Add Holding
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Holding</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="ticker" className="text-sm">
              Stock Ticker
            </Label>
            <Input
              id="ticker"
              placeholder="AAPL"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              className="font-mono uppercase"
              maxLength={10}
            />
            <div className="flex flex-wrap gap-2">
              {popularTickers.map((t) => (
                <motion.button
                  key={t}
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setTicker(t)}
                  className={`px-2 py-1 text-xs font-mono rounded border transition-all ${
                    ticker === t
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary/30 border-border/50 text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {t}
                </motion.button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="shares" className="text-sm">
                Shares
              </Label>
              <Input
                id="shares"
                type="number"
                placeholder="10"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                className="font-mono"
                min="0"
                step="any"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cost" className="text-sm">
                Avg Cost ($)
              </Label>
              <Input
                id="cost"
                type="number"
                placeholder="150.00"
                value={averageCost}
                onChange={(e) => setAverageCost(e.target.value)}
                className="font-mono"
                min="0"
                step="0.01"
              />
            </div>
          </div>

          {ticker && shares && averageCost && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="p-3 bg-secondary/30 rounded-lg text-sm"
            >
              <div className="flex justify-between text-muted-foreground">
                <span>Total Cost:</span>
                <span className="font-mono font-medium text-foreground">
                  ${(parseFloat(shares || "0") * parseFloat(averageCost || "0")).toFixed(2)}
                </span>
              </div>
            </motion.div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="glow"
              className="flex-1"
              disabled={isLoading || !ticker || !shares || !averageCost}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Adding...
                </>
              ) : (
                "Add Holding"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
