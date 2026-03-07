import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  History as HistoryIcon,
  Search,
  Loader2,
  TrendingUp,
  TrendingDown,
  Target,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { fetchWithErrorHandling, showErrorToast } from "@/lib/api-error";

interface PredictionRun {
  id: string;
  ticker: string;
  target_date: string;
  current_price: number | null;
  predicted_price: number;
  confidence: number;
  uncertainty_low: number;
  uncertainty_high: number;
  regime: string | null;
  sentiment_score: number | null;
  created_at: string;
}

interface AccuracyData {
  ticker: string;
  actualPrice: number | null;
  isAccurate: boolean | null;
  directionCorrect: boolean | null;
  isPending: boolean;
}

const History = () => {
  const navigate = useNavigate();
  const { user, session } = useAuth();
  const [predictions, setPredictions] = useState<PredictionRun[]>([]);
  const [accuracyMap, setAccuracyMap] = useState<Map<string, AccuracyData>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [searchTicker, setSearchTicker] = useState("");
  const [accuracyFilter, setAccuracyFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("date_desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      navigate("/auth");
      return;
    }
    fetchPredictions();
  }, [session]);

  const fetchPredictions = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("prediction_runs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setPredictions(data || []);

      // Check accuracy for past predictions
      if (data && data.length > 0) {
        await checkAccuracy(data);
      }
    } catch (error) {
      console.error("Fetch predictions error:", error);
      toast.error("Failed to load prediction history");
    } finally {
      setIsLoading(false);
    }
  };

  const checkAccuracy = async (predictions: PredictionRun[]) => {
    const now = new Date();
    const pastPredictions = predictions.filter(
      (p) => new Date(p.target_date) <= now
    );

    const accuracyData = new Map<string, AccuracyData>();

    // Mark pending predictions
    predictions.forEach((p) => {
      if (new Date(p.target_date) > now) {
        accuracyData.set(p.id, {
          ticker: p.ticker,
          actualPrice: null,
          isAccurate: null,
          directionCorrect: null,
          isPending: true,
        });
      }
    });

    // Fetch actual prices for past predictions using edge function
    const uniqueTickers = [...new Set(pastPredictions.map((p) => p.ticker))];

    // Fetch all tickers in parallel
    const pricePromises = uniqueTickers.map(async (ticker) => {
      try {
        const response = await fetchWithErrorHandling(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-stock-price`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ticker }),
            timeoutMs: 15000,
          }
        );

        if (!response.ok) return { ticker, data: null };

        const data = await response.json();
        return { ticker, data };
      } catch (error) {
        console.error(`Failed to fetch price for ${ticker}:`, error);
        return { ticker, data: null };
      }
    });

    const priceResults = await Promise.all(pricePromises);

    for (const { ticker, data } of priceResults) {
      if (!data || !data.priceHistory) continue;

      const priceHistory = data.priceHistory;
      
      // Find predictions for this ticker
      const tickerPredictions = pastPredictions.filter(
        (p) => p.ticker === ticker
      );

      for (const pred of tickerPredictions) {
        const targetTs = new Date(pred.target_date).getTime() / 1000;

        // Find closest price to target date
        let closestIdx = 0;
        let minDiff = Math.abs(priceHistory[0]?.timestamp - targetTs);

        for (let i = 1; i < priceHistory.length; i++) {
          const diff = Math.abs(priceHistory[i].timestamp - targetTs);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
          }
        }

        const actualPrice = priceHistory[closestIdx]?.price;

        if (actualPrice && pred.current_price) {
          const isWithinRange =
            actualPrice >= pred.uncertainty_low &&
            actualPrice <= pred.uncertainty_high;

          const predictedUp = pred.predicted_price > pred.current_price;
          const actualUp = actualPrice > pred.current_price;
          const directionCorrect = predictedUp === actualUp;

          accuracyData.set(pred.id, {
            ticker: pred.ticker,
            actualPrice,
            isAccurate: isWithinRange,
            directionCorrect,
            isPending: false,
          });
        }
      }
    }

    setAccuracyMap(accuracyData);
  };

  // Filter and sort predictions
  const filteredPredictions = predictions
    .filter((p) => {
      // Ticker filter
      if (
        searchTicker &&
        !p.ticker.toLowerCase().includes(searchTicker.toLowerCase())
      ) {
        return false;
      }

      // Accuracy filter
      if (accuracyFilter !== "all") {
        const accuracy = accuracyMap.get(p.id);
        if (accuracyFilter === "accurate" && !accuracy?.isAccurate)
          return false;
        if (
          accuracyFilter === "inaccurate" &&
          (accuracy?.isAccurate !== false || accuracy?.isPending)
        )
          return false;
        if (accuracyFilter === "pending" && !accuracy?.isPending) return false;
      }

      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "date_asc":
          return (
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        case "date_desc":
          return (
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        case "confidence_desc":
          return b.confidence - a.confidence;
        case "ticker_asc":
          return a.ticker.localeCompare(b.ticker);
        default:
          return 0;
      }
    });

  // Calculate stats
  const stats = {
    total: predictions.length,
    accurate: Array.from(accuracyMap.values()).filter((a) => a.isAccurate)
      .length,
    inaccurate: Array.from(accuracyMap.values()).filter(
      (a) => a.isAccurate === false
    ).length,
    pending: Array.from(accuracyMap.values()).filter((a) => a.isPending).length,
    avgConfidence:
      predictions.length > 0
        ? predictions.reduce((acc, p) => acc + p.confidence, 0) /
          predictions.length
        : 0,
  };

  const accuracyRate =
    stats.accurate + stats.inaccurate > 0
      ? (stats.accurate / (stats.accurate + stats.inaccurate)) * 100
      : 0;

  const getAccuracyBadge = (id: string) => {
    const accuracy = accuracyMap.get(id);

    if (!accuracy || accuracy.isPending) {
      return (
        <Badge variant="outline" className="gap-1">
          <Clock className="w-3 h-3" />
          Pending
        </Badge>
      );
    }

    if (accuracy.isAccurate) {
      return (
        <Badge className="gap-1 bg-success/20 text-success border-success/30">
          <CheckCircle2 className="w-3 h-3" />
          Accurate
        </Badge>
      );
    }

    if (accuracy.directionCorrect) {
      return (
        <Badge className="gap-1 bg-warning/20 text-warning border-warning/30">
          <AlertCircle className="w-3 h-3" />
          Direction OK
        </Badge>
      );
    }

    return (
      <Badge className="gap-1 bg-destructive/20 text-destructive border-destructive/30">
        <XCircle className="w-3 h-3" />
        Missed
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Subtle background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/4 w-[600px] h-[600px] bg-primary/2 rounded-full blur-[150px]" />
      </div>

      <main className="pt-20 pb-12 px-4 sm:px-6 relative z-10">
        <div className="container mx-auto max-w-4xl">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-medium mb-1">
                  Prediction History
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Track your prediction accuracy over time
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <HistoryIcon className="w-4 h-4 text-primary" />
                <span>{stats.total} predictions</span>
              </div>
            </div>

            {/* Stats Bar */}
            {stats.total > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <Card className="glass-card p-3 text-center">
                  <div className="text-lg font-medium text-success">
                    {accuracyRate.toFixed(0)}%
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Accuracy Rate
                  </div>
                </Card>
                <Card className="glass-card p-3 text-center">
                  <div className="text-lg font-medium text-primary">
                    {stats.accurate}
                  </div>
                  <div className="text-xs text-muted-foreground">Accurate</div>
                </Card>
                <Card className="glass-card p-3 text-center">
                  <div className="text-lg font-medium text-destructive">
                    {stats.inaccurate}
                  </div>
                  <div className="text-xs text-muted-foreground">Missed</div>
                </Card>
                <Card className="glass-card p-3 text-center">
                  <div className="text-lg font-medium text-muted-foreground">
                    {stats.pending}
                  </div>
                  <div className="text-xs text-muted-foreground">Pending</div>
                </Card>
              </div>
            )}

            {/* Filters */}
            <Card className="glass-card p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={searchTicker}
                    onChange={(e) => setSearchTicker(e.target.value.toUpperCase())}
                    placeholder="Search by ticker..."
                    className="pl-10 font-mono"
                  />
                </div>
                <Select value={accuracyFilter} onValueChange={setAccuracyFilter}>
                  <SelectTrigger className="w-full sm:w-[140px]">
                    <SelectValue placeholder="All Results" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Results</SelectItem>
                    <SelectItem value="accurate">Accurate</SelectItem>
                    <SelectItem value="inaccurate">Missed</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-full sm:w-[140px]">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date_desc">Newest First</SelectItem>
                    <SelectItem value="date_asc">Oldest First</SelectItem>
                    <SelectItem value="confidence_desc">Confidence</SelectItem>
                    <SelectItem value="ticker_asc">Ticker A-Z</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Card>
          </motion.div>

          {/* Predictions List */}
          <AnimatePresence mode="wait">
            {isLoading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="glass-card p-12 text-center"
              >
                <Loader2 className="w-8 h-8 text-primary mx-auto mb-4 animate-spin" />
                <p className="text-sm text-muted-foreground">
                  Loading prediction history...
                </p>
              </motion.div>
            ) : filteredPredictions.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="glass-card p-12 text-center"
              >
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <HistoryIcon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-sm font-medium mb-2">No predictions found</h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed mb-4">
                  {predictions.length === 0
                    ? "Start making predictions from the Dashboard to track your accuracy here."
                    : "No predictions match your current filters."}
                </p>
                {predictions.length === 0 && (
                  <Button onClick={() => navigate("/dashboard")} size="sm">
                    Go to Dashboard
                  </Button>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {filteredPredictions.map((pred, index) => {
                  const accuracy = accuracyMap.get(pred.id);
                  const isExpanded = expandedId === pred.id;
                  const priceChange = pred.current_price
                    ? ((pred.predicted_price - pred.current_price) /
                        pred.current_price) *
                      100
                    : 0;
                  const isBullish =
                    pred.current_price && pred.predicted_price > pred.current_price;

                  return (
                    <motion.div
                      key={pred.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                    >
                      <Card
                        className="glass-card p-4 cursor-pointer transition-all duration-200 hover:border-primary/30"
                        onClick={() =>
                          setExpandedId(isExpanded ? null : pred.id)
                        }
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                isBullish
                                  ? "bg-success/10"
                                  : "bg-destructive/10"
                              }`}
                            >
                              {isBullish ? (
                                <TrendingUp className="w-5 h-5 text-success" />
                              ) : (
                                <TrendingDown className="w-5 h-5 text-destructive" />
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-base font-medium text-primary">
                                  {pred.ticker}
                                </span>
                                {getAccuracyBadge(pred.id)}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                                <Calendar className="w-3 h-3" />
                                <span>
                                  Target: {format(new Date(pred.target_date), "MMM d, yyyy")}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-right hidden sm:block">
                              <div
                                className={`text-sm font-medium ${
                                  isBullish
                                    ? "text-success"
                                    : "text-destructive"
                                }`}
                              >
                                {isBullish ? "+" : ""}
                                {priceChange.toFixed(1)}%
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {pred.confidence.toFixed(0)}% confidence
                              </div>
                            </div>
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            )}
                          </div>
                        </div>

                        {/* Expanded Details */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="pt-4 mt-4 border-t border-border/50">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                                  <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                      Entry Price
                                    </div>
                                    <div className="font-mono">
                                      ${pred.current_price?.toFixed(2) || "N/A"}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                      Predicted
                                    </div>
                                    <div className="font-mono text-primary">
                                      ${pred.predicted_price.toFixed(2)}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                      Range
                                    </div>
                                    <div className="font-mono text-xs">
                                      ${pred.uncertainty_low.toFixed(2)} - $
                                      {pred.uncertainty_high.toFixed(2)}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                      {accuracy?.isPending
                                        ? "Status"
                                        : "Actual Price"}
                                    </div>
                                    <div className="font-mono">
                                      {accuracy?.isPending
                                        ? "Awaiting..."
                                        : accuracy?.actualPrice
                                        ? `$${accuracy.actualPrice.toFixed(2)}`
                                        : "N/A"}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-4 mt-4">
                                  {pred.regime && (
                                    <Badge variant="outline" className="text-xs">
                                      {pred.regime} market
                                    </Badge>
                                  )}
                                  {pred.sentiment_score !== null && (
                                    <Badge variant="outline" className="text-xs">
                                      Sentiment: {pred.sentiment_score.toFixed(1)}
                                    </Badge>
                                  )}
                                  <div className="text-xs text-muted-foreground ml-auto">
                                    Created{" "}
                                    {format(
                                      new Date(pred.created_at),
                                      "MMM d, yyyy 'at' h:mm a"
                                    )}
                                  </div>
                                </div>

                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="mt-4"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/dashboard?ticker=${pred.ticker}`);
                                  }}
                                >
                                  <Target className="w-4 h-4 mr-2" />
                                  Analyze Again
                                </Button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </Card>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
};

export default History;
