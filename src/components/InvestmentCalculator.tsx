import { useState } from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown,
  Calculator,
  ChevronDown,
  ChevronUp,
  Coins
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";

interface InvestmentCalculatorProps {
  currentPrice: number;
  predictedPrice: number;
  uncertaintyLow: number;
  uncertaintyHigh: number;
}

export const InvestmentCalculator = ({
  currentPrice,
  predictedPrice,
  uncertaintyLow,
  uncertaintyHigh,
}: InvestmentCalculatorProps) => {
  const [investmentAmount, setInvestmentAmount] = useState<string>("1000");
  const [isOpen, setIsOpen] = useState(true);

  const amount = parseFloat(investmentAmount) || 0;
  const shares = amount / currentPrice;
  const predictedValue = shares * predictedPrice;
  const expectedReturn = predictedValue - amount;
  const expectedReturnPercent = ((predictedPrice - currentPrice) / currentPrice) * 100;
  const bestCaseValue = shares * uncertaintyHigh;
  const worstCaseValue = shares * uncertaintyLow;
  const bestCaseReturn = bestCaseValue - amount;
  const worstCaseReturn = worstCaseValue - amount;
  const isPositive = expectedReturn >= 0;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <Card className="glass-card overflow-hidden">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full flex items-center justify-between p-4 hover:bg-transparent"
          >
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Investment Calculator</span>
            </div>
            {isOpen ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-4">
            {/* Investment Input */}
            <div className="space-y-2">
              <Label htmlFor="investment" className="text-xs text-muted-foreground">
                Investment Amount
              </Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="investment"
                  type="number"
                  value={investmentAmount}
                  onChange={(e) => setInvestmentAmount(e.target.value)}
                  placeholder="1000"
                  className="pl-9 font-mono bg-secondary/50 border-border/50"
                  min="0"
                  step="100"
                />
              </div>
            </div>

            {amount > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="space-y-4"
              >
                {/* Shares Info */}
                <div className="flex items-center gap-2 p-3 bg-secondary/30 rounded-lg">
                  <Coins className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    You'd own approximately{" "}
                    <span className="font-mono text-foreground">
                      {shares.toFixed(4)}
                    </span>{" "}
                    shares
                  </span>
                </div>

                {/* Main Results */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Predicted Value */}
                  <div className="p-3 rounded-lg bg-secondary/30 space-y-1">
                    <div className="text-xs text-muted-foreground">Predicted Value</div>
                    <div className="text-lg font-mono font-medium">
                      {formatCurrency(predictedValue)}
                    </div>
                  </div>

                  {/* Expected Return */}
                  <div 
                    className={`p-3 rounded-lg space-y-1 ${
                      isPositive 
                        ? "bg-success/10 border border-success/20" 
                        : "bg-destructive/10 border border-destructive/20"
                    }`}
                  >
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      Expected Return
                      {isPositive ? (
                        <TrendingUp className="w-3 h-3 text-success" />
                      ) : (
                        <TrendingDown className="w-3 h-3 text-destructive" />
                      )}
                    </div>
                    <div className={`text-lg font-mono font-medium ${
                      isPositive ? "text-success" : "text-destructive"
                    }`}>
                      {isPositive ? "+" : ""}{formatCurrency(expectedReturn)}
                    </div>
                    <div className={`text-xs font-mono ${
                      isPositive ? "text-success" : "text-destructive"
                    }`}>
                      ({isPositive ? "+" : ""}{expectedReturnPercent.toFixed(2)}%)
                    </div>
                  </div>
                </div>

                {/* Best/Worst Case */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-success/5 border border-success/10 space-y-1">
                    <div className="text-xs text-muted-foreground">Best Case</div>
                    <div className="text-sm font-mono font-medium text-success">
                      {formatCurrency(bestCaseValue)}
                    </div>
                    <div className="text-xs font-mono text-success/80">
                      +{formatCurrency(bestCaseReturn)}
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/10 space-y-1">
                    <div className="text-xs text-muted-foreground">Worst Case</div>
                    <div className="text-sm font-mono font-medium text-destructive">
                      {formatCurrency(worstCaseValue)}
                    </div>
                    <div className="text-xs font-mono text-destructive/80">
                      {worstCaseReturn >= 0 ? "+" : ""}{formatCurrency(worstCaseReturn)}
                    </div>
                  </div>
                </div>

                {/* Risk Notice */}
                <p className="text-[10px] text-muted-foreground/70 text-center">
                  Estimates based on AI predictions. Actual returns may vary significantly.
                </p>
              </motion.div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};
