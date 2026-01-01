import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Bell, TrendingUp, TrendingDown } from "lucide-react";

interface PriceAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (targetPrice: number, direction: "above" | "below") => Promise<void>;
  ticker: string;
  currentPrice?: number;
}

export const PriceAlertModal = ({
  isOpen,
  onClose,
  onSubmit,
  ticker,
  currentPrice,
}: PriceAlertModalProps) => {
  const [targetPrice, setTargetPrice] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) return;

    setIsSubmitting(true);
    try {
      await onSubmit(price, direction);
      setTargetPrice("");
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setTargetPrice("");
    setDirection("above");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            Set Price Alert
          </DialogTitle>
          <DialogDescription>
            Get notified when{" "}
            <span className="font-mono text-primary">{ticker}</span> reaches your
            target price.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {currentPrice && (
              <div className="p-3 rounded-lg bg-secondary/50 text-sm">
                <span className="text-muted-foreground">Current price: </span>
                <span className="font-mono font-medium">
                  ${currentPrice.toFixed(2)}
                </span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="direction">Alert when price goes</Label>
              <Select
                value={direction}
                onValueChange={(v) => setDirection(v as "above" | "below")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="above">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-success" />
                      Above target
                    </div>
                  </SelectItem>
                  <SelectItem value="below">
                    <div className="flex items-center gap-2">
                      <TrendingDown className="w-4 h-4 text-destructive" />
                      Below target
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="targetPrice">Target Price ($)</Label>
              <Input
                id="targetPrice"
                type="number"
                step="0.01"
                min="0.01"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                placeholder="Enter target price..."
                className="font-mono"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !targetPrice || parseFloat(targetPrice) <= 0}
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Bell className="w-4 h-4 mr-2" />
              )}
              Set Alert
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
