import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, 
  AlertCircle, AlertTriangle, ChevronRight, Info, Clock,
  Activity, Target, Shield, Zap, Calendar, BarChart3,
  Sparkles, ArrowUpRight, ArrowDownRight, Lightbulb,
  AlertOctagon, LayoutGrid, Grid3X3
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { AddToWatchlistButton } from "@/components/AddToWatchlistButton";
import { SentimentGauge } from "@/components/market/SentimentGauge";
import { MarketIndicators } from "@/components/market/MarketIndicators";
import { TrendingTickers } from "@/components/market/TrendingTickers";
import { SectorCard } from "@/components/sectors/SectorCard";
import { SectorHeatmap } from "@/components/sectors/SectorHeatmap";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ───────────────────────────────────────────────────────
type TradingStyle = "scalping" | "daytrading" | "swing" | "position";
type SortOption = "roi" | "confidence" | "risk";

interface StockOpportunity {
  ticker: string;
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;
  explanation: string;
  strength: number;
  riskLevel?: "low" | "medium" | "high";
  currentPrice?: number;
  predictedPrice?: number;
  expectedROI?: number;
  riskAdjustedROI?: number;
  volatility?: number;
  holdingPeriod?: string;
  regime?: string;
  aiReasoning?: string;
  keyCatalyst?: string;
  riskFactor?: string;
  aiEnhanced?: boolean;
}

interface MarketData {
  fearGreedScore: number;
  sp500Change: number;
  nasdaqChange: number;
  dowChange: number;
  vixValue: number;
  gainers: { ticker: string; name: string; change: number; volume: number }[];
  losers: { ticker: string; name: string; change: number; volume: number }[];
  updatedAt: string;
}

interface SectorData {
  sector: string;
  etfTicker: string;
  dailyChange: number;
  weeklyChange: number;
  monthlyChange: number;
}

// ─── Constants ───────────────────────────────────────────────────
const tradingStyleInfo: Record<TradingStyle, { 
  name: string; description: string; holdingPeriod: string; riskLevel: string; icon: React.ElementType;
}> = {
  scalping: { name: "Scalping", description: "Rapid trades capturing small price movements. Requires high volatility and quick execution.", holdingPeriod: "Minutes to hours", riskLevel: "High", icon: Zap },
  daytrading: { name: "Day Trading", description: "Opening and closing positions within the same trading day. No overnight exposure.", holdingPeriod: "Hours (same day)", riskLevel: "Medium-High", icon: Activity },
  swing: { name: "Swing Trading", description: "Capturing short-term price swings over several days. Balances risk and opportunity.", holdingPeriod: "Days to weeks", riskLevel: "Medium", icon: BarChart3 },
  position: { name: "Position Trading", description: "Long-term positions based on fundamental trends. Lower frequency, lower risk approach.", holdingPeriod: "Weeks to months", riskLevel: "Low-Medium", icon: Calendar },
};

// ─── Helper Components ───────────────────────────────────────────

function getMarketStatus() {
  const now = new Date();
  const nyTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hours = nyTime.getHours();
  const minutes = nyTime.getMinutes();
  const day = nyTime.getDay();
  if (day === 0 || day === 6) return { status: "Closed", color: "text-muted-foreground" };
  const time = hours * 60 + minutes;
  if (time >= 570 && time < 960) return { status: "Open", color: "text-success" };
  if (time >= 240 && time < 570) return { status: "Pre-Market", color: "text-warning" };
  if (time >= 960 && time < 1200) return { status: "After Hours", color: "text-warning" };
  return { status: "Closed", color: "text-muted-foreground" };
}

// ─── Main Component ──────────────────────────────────────────────

const Guide = () => {
  const navigate = useNavigate();
  const { user, session } = useAuth();
  const [activeTab, setActiveTab] = useState("opportunities");

  // Opportunities state
  const [opportunities, setOpportunities] = useState<StockOpportunity[]>([]);
  const [isLoadingOpps, setIsLoadingOpps] = useState(false);
  const [lastUpdatedOpps, setLastUpdatedOpps] = useState<Date | null>(null);
  const [noOpportunities, setNoOpportunities] = useState(false);
  const [tradingStyle, setTradingStyle] = useState<TradingStyle>("swing");
  const [sortBy, setSortBy] = useState<SortOption>("roi");

  // Market state
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [isLoadingMarket, setIsLoadingMarket] = useState(false);
  const [marketFetched, setMarketFetched] = useState(false);

  // Sectors state
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [isLoadingSectors, setIsLoadingSectors] = useState(false);
  const [sectorsFetched, setSectorsFetched] = useState(false);
  const [viewMode, setViewMode] = useState<"cards" | "heatmap">("cards");
  const [sectorSortBy, setSectorSortBy] = useState<"name" | "daily" | "weekly" | "monthly">("daily");

  // ─── Fetch functions ─────────────────────────────────────────

  const fetchOpportunities = async () => {
    if (!session?.access_token) {
      toast.error("Please sign in to access the Guide");
      navigate("/auth");
      return;
    }
    setIsLoadingOpps(true);
    setNoOpportunities(false);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stock-predict`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ mode: "guide", tradingStyle }),
        }
      );
      if (response.status === 401) { toast.error("Session expired. Please sign in again."); navigate("/auth"); return; }
      if (response.status === 429) { const d = await response.json(); toast.error(`Rate limit exceeded. Please wait ${d.retryAfter || 60} seconds.`); return; }
      if (!response.ok) throw new Error("Failed to fetch opportunities");
      const result = await response.json();
      if (result.opportunities?.length > 0) { setOpportunities(result.opportunities); setNoOpportunities(false); }
      else { setOpportunities([]); setNoOpportunities(true); }
      setLastUpdatedOpps(new Date());
    } catch (error) {
      console.error("Guide fetch error:", error);
      toast.error("Failed to fetch market opportunities");
      setNoOpportunities(true);
    } finally { setIsLoadingOpps(false); }
  };

  const fetchMarketData = async (showToast = false) => {
    setIsLoadingMarket(true);
    try {
      const { data, error } = await supabase.functions.invoke("market-sentiment");
      if (error) throw error;
      setMarketData(data);
      setMarketFetched(true);
      if (showToast) toast.success("Market data refreshed");
    } catch (error) {
      console.error("Failed to fetch market data:", error);
      toast.error("Failed to fetch market data");
    } finally { setIsLoadingMarket(false); }
  };

  const fetchSectorData = async (showToast = false) => {
    setIsLoadingSectors(true);
    try {
      const { data, error } = await supabase.functions.invoke("sector-analysis");
      if (error) throw error;
      setSectors(data.sectors || []);
      setSectorsFetched(true);
      if (showToast) toast.success("Sector data refreshed");
    } catch (error) {
      console.error("Failed to fetch sector data:", error);
      toast.error("Failed to fetch sector data");
    } finally { setIsLoadingSectors(false); }
  };

  // ─── Effects ─────────────────────────────────────────────────

  useEffect(() => {
    if (session?.access_token) fetchOpportunities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradingStyle, session?.access_token]);

  // Lazy-load market/sector data when tab is first selected
  useEffect(() => {
    if (activeTab === "market" && !marketFetched && !isLoadingMarket) fetchMarketData();
    if (activeTab === "sectors" && !sectorsFetched && !isLoadingSectors) fetchSectorData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ─── Derived data ────────────────────────────────────────────

  const sortedOpportunities = [...opportunities].sort((a, b) => {
    switch (sortBy) {
      case "roi": return Math.abs(b.expectedROI || 0) - Math.abs(a.expectedROI || 0);
      case "confidence": return b.confidence - a.confidence;
      case "risk": { const ro = { low: 1, medium: 2, high: 3 }; return (ro[a.riskLevel || "medium"] || 2) - (ro[b.riskLevel || "medium"] || 2); }
      default: return 0;
    }
  });

  const sortedSectors = [...sectors].sort((a, b) => {
    switch (sectorSortBy) {
      case "name": return a.sector.localeCompare(b.sector);
      case "daily": return b.dailyChange - a.dailyChange;
      case "weekly": return b.weeklyChange - a.weeklyChange;
      case "monthly": return b.monthlyChange - a.monthlyChange;
      default: return 0;
    }
  });

  const avgROI = opportunities.length > 0 ? opportunities.reduce((s, o) => s + (o.expectedROI || 0), 0) / opportunities.length : 0;
  const topPick = opportunities.length > 0 ? opportunities.reduce((m, o) => (Math.abs(o.expectedROI || 0) > Math.abs(m.expectedROI || 0) ? o : m), opportunities[0]) : null;
  const currentStyleInfo = tradingStyleInfo[tradingStyle];
  const StyleIcon = currentStyleInfo.icon;
  const marketStatus = getMarketStatus();

  // ─── Helpers ─────────────────────────────────────────────────

  const handleStockClick = (ticker: string) => navigate(`/dashboard?ticker=${ticker}`);
  const getDirectionIcon = (d: string) => d === "bullish" ? <TrendingUp className="w-4 h-4" /> : d === "bearish" ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />;
  const getDirectionColor = (d: string) => d === "bullish" ? "text-success bg-success/10 border-success/20" : d === "bearish" ? "text-destructive bg-destructive/10 border-destructive/20" : "text-warning bg-warning/10 border-warning/20";
  const formatVol = (v?: number) => v ? `${(v * 100).toFixed(1)}%` : "N/A";
  const formatPrice = (p?: number) => p ? `$${p.toFixed(2)}` : "N/A";

  const getRiskBadge = (riskLevel?: string) => {
    const level = riskLevel || "medium";
    const colors: Record<string, string> = { low: "text-success bg-success/10 border-success/20", medium: "text-warning bg-warning/10 border-warning/20", high: "text-destructive bg-destructive/10 border-destructive/20" };
    return <Badge variant="outline" className={`${colors[level]} border gap-1 text-xs`}><AlertTriangle className="w-3 h-3" />{level.charAt(0).toUpperCase() + level.slice(1)} Risk</Badge>;
  };

  const getROIBadge = (roi?: number) => {
    if (roi === undefined || roi === null) return null;
    const pos = roi >= 0;
    const color = pos ? "text-success bg-success/10 border-success/20" : "text-destructive bg-destructive/10 border-destructive/20";
    const Icon = pos ? ArrowUpRight : ArrowDownRight;
    return <Badge variant="outline" className={`${color} border gap-1 text-xs font-mono`}><Icon className="w-3 h-3" />{pos ? "+" : ""}{roi.toFixed(1)}% ROI</Badge>;
  };

  // ─── Render ──────────────────────────────────────────────────

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/2 rounded-full blur-[150px]" />
        </div>

        <main className="pt-20 pb-12 px-4 sm:px-6 relative z-10">
          <div className="container mx-auto max-w-6xl">
            {/* Header */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                <div>
                  <h1 className="text-xl sm:text-2xl font-medium mb-1">Guide</h1>
                  <p className="text-xs sm:text-sm text-muted-foreground">AI-powered market intelligence</p>
                </div>
              </div>

              {/* Main Tabs */}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="bg-secondary/30">
                  <TabsTrigger value="opportunities" className="text-xs sm:text-sm">Opportunities</TabsTrigger>
                  <TabsTrigger value="market" className="text-xs sm:text-sm">Market</TabsTrigger>
                  <TabsTrigger value="sectors" className="text-xs sm:text-sm">Sectors</TabsTrigger>
                </TabsList>

                {/* ════════════════ OPPORTUNITIES TAB ════════════════ */}
                <TabsContent value="opportunities" className="mt-6">
                  {/* Trading Style + Refresh */}
                  <div className="flex items-center justify-end mb-4">
                    <Button variant="ghost" size="sm" onClick={fetchOpportunities} disabled={isLoadingOpps} className="gap-2 text-muted-foreground">
                      {isLoadingOpps ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Refresh
                    </Button>
                  </div>

                  <Card className="glass-card p-4 sm:p-5 mb-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <StyleIcon className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">Trading Style</span>
                            <Tooltip><TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs"><p className="text-xs">Select your preferred trading approach. Results are filtered to match your style's volatility and holding period preferences.</p></TooltipContent>
                            </Tooltip>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{currentStyleInfo.description}</p>
                        </div>
                      </div>
                      <Select value={tradingStyle} onValueChange={(v) => setTradingStyle(v as TradingStyle)}>
                        <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(tradingStyleInfo) as TradingStyle[]).map((style) => {
                            const info = tradingStyleInfo[style]; const Icon = info.icon;
                            return <SelectItem key={style} value={style}><div className="flex items-center gap-2"><Icon className="w-4 h-4" /><span>{info.name}</span></div></SelectItem>;
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-border/30">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="w-3.5 h-3.5" /><span>{currentStyleInfo.holdingPeriod}</span></div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Shield className="w-3.5 h-3.5" /><span>{currentStyleInfo.riskLevel} Risk</span></div>
                    </div>
                  </Card>

                  {/* Summary Stats & Sort */}
                  {opportunities.length > 0 && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                      <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">Avg ROI:</span>
                          <span className={`font-mono font-medium ${avgROI >= 0 ? 'text-success' : 'text-destructive'}`}>{avgROI >= 0 ? '+' : ''}{avgROI.toFixed(1)}%</span>
                        </div>
                        {topPick && (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">Top Pick:</span>
                            <span className="font-mono font-medium text-primary">{topPick.ticker}</span>
                            <span className={`font-mono ${(topPick.expectedROI || 0) >= 0 ? 'text-success' : 'text-destructive'}`}>({(topPick.expectedROI || 0) >= 0 ? '+' : ''}{(topPick.expectedROI || 0).toFixed(1)}%)</span>
                          </div>
                        )}
                      </div>
                      <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                        <SelectTrigger className="w-full sm:w-[160px]"><SelectValue placeholder="Sort by..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="roi">Highest ROI</SelectItem>
                          <SelectItem value="confidence">Highest Confidence</SelectItem>
                          <SelectItem value="risk">Lowest Risk</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {lastUpdatedOpps && <p className="text-xs text-muted-foreground mb-4">Last updated: {lastUpdatedOpps.toLocaleTimeString()}</p>}

                  {/* Opportunity Cards */}
                  <AnimatePresence mode="wait">
                    {isLoadingOpps && opportunities.length === 0 ? (
                      <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card p-12 sm:p-16 text-center">
                        <Loader2 className="w-8 h-8 text-primary mx-auto mb-4 animate-spin" />
                        <p className="text-sm text-muted-foreground">Scanning market for {tradingStyleInfo[tradingStyle].name.toLowerCase()} opportunities...</p>
                        <p className="text-xs text-muted-foreground/60 mt-2">Scanning markets and analyzing opportunities...</p>
                      </motion.div>
                    ) : noOpportunities ? (
                      <motion.div key="empty" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="glass-card p-12 sm:p-16 text-center">
                        <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-4"><AlertCircle className="w-6 h-6 text-warning" /></div>
                        <h3 className="text-sm font-medium mb-2">No Strong Opportunities</h3>
                        <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">Market conditions are not favorable for {tradingStyleInfo[tradingStyle].name.toLowerCase()} right now. Try a different trading style or check back later.</p>
                      </motion.div>
                    ) : (
                      <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
                        {sortedOpportunities.map((opp, index) => (
                          <motion.div key={opp.ticker} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }}>
                            <Card className="glass-card p-4 sm:p-5 cursor-pointer transition-all duration-200 hover:border-primary/30 hover:bg-primary/5 group" onClick={() => handleStockClick(opp.ticker)}>
                              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-2 mb-2">
                                    <span className="font-mono text-base sm:text-lg font-medium text-primary group-hover:text-primary/90">{opp.ticker}</span>
                                    <Badge variant="outline" className={`${getDirectionColor(opp.direction)} border gap-1 text-xs`}>{getDirectionIcon(opp.direction)}{opp.direction.charAt(0).toUpperCase() + opp.direction.slice(1)}</Badge>
                                    {getROIBadge(opp.expectedROI)}
                                    {getRiskBadge(opp.riskLevel)}
                                    {opp.aiEnhanced && <Badge variant="outline" className="text-primary bg-primary/10 border-primary/20 gap-1 text-xs"><Sparkles className="w-3 h-3" />AI Enhanced</Badge>}
                                  </div>
                                  {opp.aiReasoning ? <p className="text-xs sm:text-sm text-foreground leading-relaxed mb-3">{opp.aiReasoning}</p> : <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed mb-3">{opp.explanation}</p>}
                                  {(opp.keyCatalyst || opp.riskFactor) && (
                                    <div className="flex flex-wrap gap-3 mb-3">
                                      {opp.keyCatalyst && <div className="flex items-start gap-1.5 text-xs"><Lightbulb className="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" /><span className="text-muted-foreground"><span className="font-medium text-foreground">Catalyst:</span> {opp.keyCatalyst}</span></div>}
                                      {opp.riskFactor && <div className="flex items-start gap-1.5 text-xs"><AlertOctagon className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" /><span className="text-muted-foreground"><span className="font-medium text-foreground">Risk:</span> {opp.riskFactor}</span></div>}
                                    </div>
                                  )}
                                  <div className="flex flex-wrap gap-3 sm:gap-4">
                                    <Tooltip><TooltipTrigger asChild><div className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help"><Target className="w-3.5 h-3.5" /><span className="font-mono">{formatPrice(opp.currentPrice)}</span><span className="text-primary">→</span><span className="font-mono text-foreground">{formatPrice(opp.predictedPrice)}</span></div></TooltipTrigger><TooltipContent><p className="text-xs">Current → Predicted Price</p></TooltipContent></Tooltip>
                                    <Tooltip><TooltipTrigger asChild><div className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help"><Activity className="w-3.5 h-3.5" /><span>Vol: {formatVol(opp.volatility)}</span></div></TooltipTrigger><TooltipContent><p className="text-xs">Daily Volatility (20-day)</p></TooltipContent></Tooltip>
                                    <Tooltip><TooltipTrigger asChild><div className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help"><Clock className="w-3.5 h-3.5" /><span>{opp.holdingPeriod || currentStyleInfo.holdingPeriod}</span></div></TooltipTrigger><TooltipContent><p className="text-xs">Expected Holding Period</p></TooltipContent></Tooltip>
                                  </div>
                                </div>
                                <div className="flex sm:flex-col items-center gap-3 sm:gap-2">
                                  <Tooltip><TooltipTrigger asChild>
                                    <div className="relative w-14 h-14 shrink-0">
                                      <svg className="w-14 h-14 -rotate-90"><circle cx="28" cy="28" r="24" strokeWidth="4" fill="none" className="stroke-muted/20" /><circle cx="28" cy="28" r="24" strokeWidth="4" fill="none" strokeLinecap="round" className="stroke-primary" strokeDasharray={`${(opp.confidence / 100) * 150.8} 150.8`} /></svg>
                                      <div className="absolute inset-0 flex items-center justify-center"><span className="text-xs font-mono font-medium">{opp.confidence}%</span></div>
                                    </div>
                                  </TooltipTrigger><TooltipContent><p className="text-xs">AI Confidence Score</p></TooltipContent></Tooltip>
                                  <div className="flex items-center gap-2">
                                    <AddToWatchlistButton ticker={opp.ticker} assetType={opp.ticker.includes('-') ? 'crypto' : 'stock'} />
                                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors hidden sm:block" />
                                  </div>
                                </div>
                              </div>
                            </Card>
                          </motion.div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </TabsContent>

                {/* ════════════════ MARKET TAB ════════════════ */}
                <TabsContent value="market" className="mt-6">
                  <div className="flex items-center justify-between mb-4">
                    <Badge variant="outline" className={`${marketStatus.color} gap-1`}><Activity className="w-3 h-3" />{marketStatus.status}</Badge>
                    <Button variant="ghost" size="sm" onClick={() => fetchMarketData(true)} disabled={isLoadingMarket}>
                      <RefreshCw className={`w-4 h-4 ${isLoadingMarket ? "animate-spin" : ""}`} />
                    </Button>
                  </div>

                  {isLoadingMarket && !marketData ? (
                    <div className="space-y-6">
                      <div className="grid md:grid-cols-3 gap-6">
                        <Skeleton className="h-[280px]" />
                        <div className="md:col-span-2 space-y-4"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
                      </div>
                      <Skeleton className="h-[300px]" />
                    </div>
                  ) : marketData ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                      <div className="grid md:grid-cols-3 gap-6">
                        <SentimentGauge score={marketData.fearGreedScore} />
                        <div className="md:col-span-2 space-y-4">
                          <MarketIndicators data={{ sp500Change: marketData.sp500Change, nasdaqChange: marketData.nasdaqChange, dowChange: marketData.dowChange, vixValue: marketData.vixValue }} />
                          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock className="w-3 h-3" /><span>Updated: {new Date(marketData.updatedAt).toLocaleTimeString()}</span></div>
                        </div>
                      </div>
                      <TrendingTickers gainers={marketData.gainers} losers={marketData.losers} />
                    </motion.div>
                  ) : (
                    <Card className="glass-card p-12 text-center">
                      <p className="text-muted-foreground">Failed to load market data</p>
                      <Button variant="ghost" className="mt-4" onClick={() => fetchMarketData()}>Try Again</Button>
                    </Card>
                  )}
                </TabsContent>

                {/* ════════════════ SECTORS TAB ════════════════ */}
                <TabsContent value="sectors" className="mt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 p-1 bg-secondary/50 rounded-lg">
                        <Button variant="ghost" size="sm" onClick={() => setViewMode("cards")} className={`h-7 px-2 text-xs ${viewMode === "cards" ? "bg-background shadow-sm" : ""}`}><LayoutGrid className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => setViewMode("heatmap")} className={`h-7 px-2 text-xs ${viewMode === "heatmap" ? "bg-background shadow-sm" : ""}`}><Grid3X3 className="w-3 h-3" /></Button>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => fetchSectorData(true)} disabled={isLoadingSectors}>
                      <RefreshCw className={`w-4 h-4 ${isLoadingSectors ? "animate-spin" : ""}`} />
                    </Button>
                  </div>

                  {viewMode === "cards" && !isLoadingSectors && sectors.length > 0 && (
                    <div className="mb-4">
                      <Tabs value={sectorSortBy} onValueChange={(v) => setSectorSortBy(v as typeof sectorSortBy)}>
                        <TabsList className="bg-secondary/30">
                          <TabsTrigger value="daily" className="text-xs">Daily</TabsTrigger>
                          <TabsTrigger value="weekly" className="text-xs">Weekly</TabsTrigger>
                          <TabsTrigger value="monthly" className="text-xs">Monthly</TabsTrigger>
                          <TabsTrigger value="name" className="text-xs">A-Z</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                  )}

                  {isLoadingSectors && sectors.length === 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {Array.from({ length: 11 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
                    </div>
                  ) : sectors.length > 0 ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      {viewMode === "cards" ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                          {sortedSectors.map((sector, index) => (
                            <motion.div key={sector.etfTicker} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}>
                              <SectorCard {...sector} />
                            </motion.div>
                          ))}
                        </div>
                      ) : (
                        <SectorHeatmap sectors={sectors} />
                      )}
                    </motion.div>
                  ) : (
                    <Card className="glass-card p-12 text-center">
                      <p className="text-muted-foreground">No sector data available</p>
                      <Button variant="ghost" className="mt-4" onClick={() => fetchSectorData()}>Try Again</Button>
                    </Card>
                  )}
                </TabsContent>
              </Tabs>
            </motion.div>

            {/* Disclaimer */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-8 p-4 rounded-lg bg-warning/5 border border-warning/10">
              <div className="flex gap-3">
                <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-medium text-warning">Disclaimer:</span> These AI-generated insights are for educational purposes only and should not be considered financial advice. Always conduct your own research and consult with a qualified financial advisor before making investment decisions.
                </p>
              </div>
            </motion.div>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
};

export default Guide;
