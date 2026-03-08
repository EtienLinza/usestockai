import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Radio, Loader2, TrendingUp, TrendingDown, AlertTriangle,
  RefreshCw, Zap, DollarSign, Target, ArrowUpRight, ArrowDownRight,
  Package, BarChart3, Clock, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Signal {
  id: string;
  ticker: string;
  signal_type: "BUY" | "SELL";
  entry_price: number;
  confidence: number;
  regime: string;
  stock_profile: string;
  weekly_bias: string;
  target_allocation: number;
  reasoning: string;
  strategy: string;
  created_at: string;
  expires_at: string;
  sector?: string;
}

interface Position {
  id: string;
  ticker: string;
  entry_price: number;
  shares: number;
  position_type: "long" | "short";
  status: "open" | "closed";
  exit_price: number | null;
  pnl: number | null;
  created_at: string;
  closed_at: string | null;
  exit_reason: string | null;
}

const Signals = () => {
  const { user } = useAuth();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ batch: 0, total: 0 });
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [shareAmount, setShareAmount] = useState("");
  const [sellDialogOpen, setSellDialogOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [sellPrice, setSellPrice] = useState("");
  const [activeTab, setActiveTab] = useState("signals");

  // Load signals and positions
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: signalData } = await supabase
        .from("live_signals")
        .select("*")
        .gte("expires_at", new Date().toISOString())
        .order("confidence", { ascending: false });

      if (signalData) setSignals(signalData as Signal[]);

      if (user) {
        const { data: posData } = await supabase
          .from("virtual_positions")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (posData) setPositions(posData as Position[]);
      }
    } catch (err) {
      console.error("Failed to load data:", err);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime subscription for new signals
  useEffect(() => {
    const channel = supabase
      .channel("live-signals")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_signals" }, () => {
        loadData();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  // Run market scan
  const runScan = async () => {
    if (!user) {
      toast.error("Please sign in to scan the market");
      return;
    }
    setScanning(true);
    setScanProgress({ batch: 0, total: 3 });

    try {
      let batch = 0;
      let done = false;
      let totalSignals = 0;

      while (!done) {
        setScanProgress({ batch: batch + 1, total: 3 });
        const { data, error } = await supabase.functions.invoke("market-scanner", {
          body: { batch, batchSize: 25, checkSells: batch === 0, userId: user.id },
        });

        if (error) throw error;
        totalSignals += data.signals?.length || 0;
        done = data.done;
        batch++;

        if (!done) await new Promise(r => setTimeout(r, 500));
      }

      toast.success(`Scan complete! Found ${totalSignals} signals across ${batch} batches`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Scan failed");
    }
    setScanning(false);
  };

  // Register buy
  const handleBuy = async () => {
    if (!user || !selectedSignal || !shareAmount) return;
    const shares = parseFloat(shareAmount);
    if (isNaN(shares) || shares <= 0) {
      toast.error("Enter a valid number of shares");
      return;
    }

    const { error } = await supabase.from("virtual_positions").insert({
      user_id: user.id,
      ticker: selectedSignal.ticker,
      entry_price: selectedSignal.entry_price,
      shares,
      position_type: selectedSignal.signal_type === "BUY" ? "long" : "short",
      signal_id: selectedSignal.id,
    });

    if (error) {
      toast.error("Failed to register position");
    } else {
      toast.success(`Registered ${shares} shares of ${selectedSignal.ticker} at $${Number(selectedSignal.entry_price).toFixed(2)}`);
      setBuyDialogOpen(false);
      setShareAmount("");
      await loadData();
    }
  };

  // Close position
  const handleSell = async () => {
    if (!selectedPosition || !sellPrice) return;
    const price = parseFloat(sellPrice);
    if (isNaN(price) || price <= 0) {
      toast.error("Enter a valid price");
      return;
    }

    const pnl = selectedPosition.position_type === "long"
      ? (price - Number(selectedPosition.entry_price)) * Number(selectedPosition.shares)
      : (Number(selectedPosition.entry_price) - price) * Number(selectedPosition.shares);

    const { error } = await supabase
      .from("virtual_positions")
      .update({
        status: "closed",
        exit_price: price,
        exit_date: new Date().toISOString(),
        exit_reason: "manual",
        pnl,
        closed_at: new Date().toISOString(),
      })
      .eq("id", selectedPosition.id);

    if (error) {
      toast.error("Failed to close position");
    } else {
      toast.success(`Closed ${selectedPosition.ticker} at $${price.toFixed(2)} | P&L: $${pnl.toFixed(2)}`);
      setSellDialogOpen(false);
      setSellPrice("");
      await loadData();
    }
  };

  const openPositions = positions.filter(p => p.status === "open");
  const closedPositions = positions.filter(p => p.status === "closed");
  const totalPnL = closedPositions.reduce((sum, p) => sum + (Number(p.pnl) || 0), 0);
  const buySignals = signals.filter(s => s.signal_type === "BUY");
  const sellSignals = signals.filter(s => s.signal_type === "SELL");

  const getConfidenceColor = (c: number) => {
    if (c >= 80) return "text-success";
    if (c >= 65) return "text-primary";
    return "text-warning";
  };

  const getRegimeBadge = (regime: string) => {
    const colors: Record<string, string> = {
      strong_bullish: "bg-success/20 text-success border-success/30",
      bullish: "bg-success/10 text-success border-success/20",
      strong_bearish: "bg-destructive/20 text-destructive border-destructive/30",
      bearish: "bg-destructive/10 text-destructive border-destructive/20",
      neutral: "bg-muted text-muted-foreground border-border",
      overbought: "bg-warning/20 text-warning border-warning/30",
      oversold: "bg-primary/20 text-primary border-primary/30",
    };
    return colors[regime] || colors.neutral;
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 pt-20 pb-10 max-w-7xl">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                <Zap className="w-8 h-8 text-primary" />
                Live Signals
              </h1>
              <p className="text-muted-foreground mt-1">
                AI-powered market scanner • {signals.length} active signals • {openPositions.length} open positions
              </p>
            </div>
            <Button
              variant="glow"
              size="lg"
              onClick={runScan}
              disabled={scanning || !user}
              className="gap-2"
            >
              {scanning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Scanning batch {scanProgress.batch}/{scanProgress.total}...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Scan Market
                </>
              )}
            </Button>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <Card variant="stat">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <TrendingUp className="w-4 h-4 text-success" />
                  Buy Signals
                </div>
                <div className="text-2xl font-bold mt-1">{buySignals.length}</div>
              </CardContent>
            </Card>
            <Card variant="stat">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Package className="w-4 h-4 text-primary" />
                  Open Positions
                </div>
                <div className="text-2xl font-bold mt-1">{openPositions.length}</div>
              </CardContent>
            </Card>
            <Card variant="stat">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  Closed Trades
                </div>
                <div className="text-2xl font-bold mt-1">{closedPositions.length}</div>
              </CardContent>
            </Card>
            <Card variant="stat">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <DollarSign className="w-4 h-4" />
                  Total P&L
                </div>
                <div className={cn("text-2xl font-bold mt-1", totalPnL >= 0 ? "text-success" : "text-destructive")}>
                  {totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(2)}
                </div>
              </CardContent>
            </Card>
          </div>
        </motion.div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="signals" className="gap-2">
              <Zap className="w-4 h-4" />
              Signals ({signals.length})
            </TabsTrigger>
            <TabsTrigger value="portfolio" className="gap-2">
              <Package className="w-4 h-4" />
              Portfolio ({openPositions.length})
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <Clock className="w-4 h-4" />
              Trade History ({closedPositions.length})
            </TabsTrigger>
          </TabsList>

          {/* Signals Tab */}
          <TabsContent value="signals">
            <AnimatePresence mode="wait">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : signals.length === 0 ? (
                <Card variant="glass" className="p-12 text-center">
                  <Zap className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Active Signals</h3>
                  <p className="text-muted-foreground mb-6">
                    Click "Scan Market" to analyze 75 stocks across all sectors
                  </p>
                  <Button variant="glow" onClick={runScan} disabled={scanning || !user}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Run First Scan
                  </Button>
                </Card>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-3"
                >
                  {signals.map((signal, idx) => (
                    <motion.div
                      key={signal.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.03 }}
                    >
                      <Card variant="glass" className="hover:border-primary/30 transition-all">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between flex-wrap gap-3">
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2">
                                {signal.signal_type === "BUY" ? (
                                  <ArrowUpRight className="w-5 h-5 text-success" />
                                ) : (
                                  <ArrowDownRight className="w-5 h-5 text-destructive" />
                                )}
                                <span className="text-lg font-bold font-mono">{signal.ticker}</span>
                                <Badge
                                  variant="outline"
                                  className={signal.signal_type === "BUY"
                                    ? "bg-success/10 text-success border-success/30"
                                    : "bg-destructive/10 text-destructive border-destructive/30"
                                  }
                                >
                                  {signal.signal_type}
                                </Badge>
                              </div>

                              <div className="hidden sm:flex items-center gap-2">
                                <Badge variant="outline" className={getRegimeBadge(signal.regime)}>
                                  {signal.regime.replace("_", " ")}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  {signal.stock_profile}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  {signal.strategy}
                                </Badge>
                              </div>
                            </div>

                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <div className="text-sm text-muted-foreground">Entry</div>
                                <div className="font-mono font-semibold">${Number(signal.entry_price).toFixed(2)}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm text-muted-foreground">Confidence</div>
                                <div className={cn("font-mono font-bold", getConfidenceColor(signal.confidence))}>
                                  {signal.confidence}%
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant={signal.signal_type === "BUY" ? "success" : "destructive"}
                                onClick={() => {
                                  if (!user) { toast.error("Please sign in first"); return; }
                                  setSelectedSignal(signal);
                                  setBuyDialogOpen(true);
                                }}
                              >
                                Register {signal.signal_type === "BUY" ? "Buy" : "Short"}
                              </Button>
                            </div>
                          </div>

                          {signal.reasoning && (
                            <p className="text-sm text-muted-foreground mt-2 border-t border-border/30 pt-2">
                              {signal.reasoning}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </TabsContent>

          {/* Portfolio Tab */}
          <TabsContent value="portfolio">
            {openPositions.length === 0 ? (
              <Card variant="glass" className="p-12 text-center">
                <Package className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Open Positions</h3>
                <p className="text-muted-foreground">
                  Register a buy from the Signals tab to start tracking
                </p>
              </Card>
            ) : (
              <Card variant="glass">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ticker</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Entry Price</TableHead>
                      <TableHead>Shares</TableHead>
                      <TableHead>Position Value</TableHead>
                      <TableHead>Opened</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openPositions.map((pos) => (
                      <TableRow key={pos.id}>
                        <TableCell className="font-mono font-bold">{pos.ticker}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={pos.position_type === "long" ? "text-success" : "text-destructive"}>
                            {pos.position_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono">${Number(pos.entry_price).toFixed(2)}</TableCell>
                        <TableCell className="font-mono">{Number(pos.shares).toFixed(2)}</TableCell>
                        <TableCell className="font-mono">
                          ${(Number(pos.entry_price) * Number(pos.shares)).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(pos.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedPosition(pos);
                              setSellPrice("");
                              setSellDialogOpen(true);
                            }}
                          >
                            Close Position
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history">
            {closedPositions.length === 0 ? (
              <Card variant="glass" className="p-12 text-center">
                <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Trade History</h3>
                <p className="text-muted-foreground">
                  Closed positions will appear here
                </p>
              </Card>
            ) : (
              <Card variant="glass">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ticker</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Entry</TableHead>
                      <TableHead>Exit</TableHead>
                      <TableHead>Shares</TableHead>
                      <TableHead>P&L</TableHead>
                      <TableHead>Exit Reason</TableHead>
                      <TableHead>Closed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closedPositions.map((pos) => (
                      <TableRow key={pos.id}>
                        <TableCell className="font-mono font-bold">{pos.ticker}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={pos.position_type === "long" ? "text-success" : "text-destructive"}>
                            {pos.position_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono">${Number(pos.entry_price).toFixed(2)}</TableCell>
                        <TableCell className="font-mono">${pos.exit_price ? Number(pos.exit_price).toFixed(2) : "—"}</TableCell>
                        <TableCell className="font-mono">{Number(pos.shares).toFixed(2)}</TableCell>
                        <TableCell className={cn("font-mono font-bold", (Number(pos.pnl) || 0) >= 0 ? "text-success" : "text-destructive")}>
                          {(Number(pos.pnl) || 0) >= 0 ? "+" : ""}${(Number(pos.pnl) || 0).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-sm">{pos.exit_reason || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {pos.closed_at ? new Date(pos.closed_at).toLocaleDateString() : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Buy Dialog */}
        <Dialog open={buyDialogOpen} onOpenChange={setBuyDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selectedSignal?.signal_type === "BUY" ? (
                  <ArrowUpRight className="w-5 h-5 text-success" />
                ) : (
                  <ArrowDownRight className="w-5 h-5 text-destructive" />
                )}
                Register {selectedSignal?.signal_type} — {selectedSignal?.ticker}
              </DialogTitle>
              <DialogDescription>
                This doesn't execute a real trade. Register how many shares you bought on your trading platform.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Entry Price</span>
                <span className="font-mono font-bold">${selectedSignal ? Number(selectedSignal.entry_price).toFixed(2) : "—"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Confidence</span>
                <span className={cn("font-mono font-bold", getConfidenceColor(selectedSignal?.confidence || 0))}>
                  {selectedSignal?.confidence}%
                </span>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Number of Shares</label>
                <Input
                  type="number"
                  placeholder="e.g. 10"
                  value={shareAmount}
                  onChange={(e) => setShareAmount(e.target.value)}
                  variant="glow"
                />
                {shareAmount && selectedSignal && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Total: ${(parseFloat(shareAmount) * Number(selectedSignal.entry_price)).toFixed(2)}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBuyDialogOpen(false)}>Cancel</Button>
              <Button variant="success" onClick={handleBuy}>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Confirm Registration
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Sell Dialog */}
        <Dialog open={sellDialogOpen} onOpenChange={setSellDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Close Position — {selectedPosition?.ticker}</DialogTitle>
              <DialogDescription>
                Enter the price at which you sold on your trading platform.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Entry Price</span>
                <span className="font-mono font-bold">${selectedPosition ? Number(selectedPosition.entry_price).toFixed(2) : "—"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Shares</span>
                <span className="font-mono">{selectedPosition ? Number(selectedPosition.shares).toFixed(2) : "—"}</span>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Exit Price</label>
                <Input
                  type="number"
                  placeholder="e.g. 155.00"
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                  variant="glow"
                />
                {sellPrice && selectedPosition && (
                  <p className={cn("text-sm mt-2 font-mono", 
                    (() => {
                      const pnl = selectedPosition.position_type === "long"
                        ? (parseFloat(sellPrice) - Number(selectedPosition.entry_price)) * Number(selectedPosition.shares)
                        : (Number(selectedPosition.entry_price) - parseFloat(sellPrice)) * Number(selectedPosition.shares);
                      return pnl >= 0 ? "text-success" : "text-destructive";
                    })()
                  )}>
                    P&L: ${(() => {
                      const pnl = selectedPosition.position_type === "long"
                        ? (parseFloat(sellPrice) - Number(selectedPosition.entry_price)) * Number(selectedPosition.shares)
                        : (Number(selectedPosition.entry_price) - parseFloat(sellPrice)) * Number(selectedPosition.shares);
                      return (pnl >= 0 ? "+" : "") + pnl.toFixed(2);
                    })()}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSellDialogOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleSell}>
                Close Position
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default Signals;
