import { useState } from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  TrendingUp, 
  TrendingDown, 
  Trash2, 
  RefreshCw,
  ExternalLink
} from "lucide-react";
import { useNavigate } from "react-router-dom";

export interface Holding {
  id: string;
  ticker: string;
  shares: number;
  averageCost: number;
  currentPrice: number;
  previousClose?: number;
}

interface HoldingsTableProps {
  holdings: Holding[];
  isLoading: boolean;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}

export const HoldingsTable = ({
  holdings,
  isLoading,
  onDelete,
  onRefresh,
}: HoldingsTableProps) => {
  const navigate = useNavigate();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const handleAnalyze = (ticker: string) => {
    navigate(`/dashboard?ticker=${ticker}`);
  };

  return (
    <Card className="glass-card overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-border/30">
        <h3 className="text-sm font-medium">Holdings</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh Prices
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs">Symbol</TableHead>
              <TableHead className="text-xs text-right">Shares</TableHead>
              <TableHead className="text-xs text-right">Avg Cost</TableHead>
              <TableHead className="text-xs text-right">Price</TableHead>
              <TableHead className="text-xs text-right">Value</TableHead>
              <TableHead className="text-xs text-right">P&L</TableHead>
              <TableHead className="text-xs text-right">Day</TableHead>
              <TableHead className="text-xs text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {holdings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No holdings yet. Add your first position!
                </TableCell>
              </TableRow>
            ) : (
              holdings.map((holding, index) => {
                const marketValue = holding.shares * holding.currentPrice;
                const totalCost = holding.shares * holding.averageCost;
                const pnl = marketValue - totalCost;
                const pnlPercent = ((holding.currentPrice - holding.averageCost) / holding.averageCost) * 100;
                const isPnLPositive = pnl >= 0;
                
                const dayChange = holding.previousClose 
                  ? holding.currentPrice - holding.previousClose 
                  : 0;
                const dayChangePercent = holding.previousClose 
                  ? ((holding.currentPrice - holding.previousClose) / holding.previousClose) * 100 
                  : 0;
                const isDayPositive = dayChange >= 0;

                return (
                  <motion.tr
                    key={holding.id}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="group hover:bg-secondary/30"
                  >
                    <TableCell className="font-mono font-medium">
                      {holding.ticker}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {holding.shares.toFixed(4)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {formatCurrency(holding.averageCost)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(holding.currentPrice)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatCurrency(marketValue)}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${isPnLPositive ? "text-success" : "text-destructive"}`}>
                      <div className="flex items-center justify-end gap-1">
                        {isPnLPositive ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        <span>{isPnLPositive ? "+" : ""}{formatCurrency(pnl)}</span>
                      </div>
                      <div className="text-xs opacity-80">
                        {isPnLPositive ? "+" : ""}{pnlPercent.toFixed(2)}%
                      </div>
                    </TableCell>
                    <TableCell className={`text-right font-mono text-xs ${isDayPositive ? "text-success" : "text-destructive"}`}>
                      {isDayPositive ? "+" : ""}{dayChangePercent.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => handleAnalyze(holding.ticker)}
                          title="Analyze"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => onDelete(holding.id)}
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </motion.tr>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
};
