import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import {
  ArrowRight, TrendingUp, Brain, Zap, BarChart3, Shield,
  Target, Activity, LineChart, PieChart, Bell, Eye,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const FAQS = [
  {
    q: "Is there an AI that can predict stocks?",
    a: "StockAI uses an ensemble of technical indicators, regime detection, and weighted signal consensus to generate AI stock predictions with calibrated confidence intervals. It is research and paper-trading only — not financial advice.",
  },
  {
    q: "How do AI stock signals work on StockAI?",
    a: "A background market scanner evaluates 6,000+ tickers using 10+ indicators, gap analysis, and isotonic-calibrated conviction scores, then publishes high-conviction buy/sell signals with full reasoning.",
  },
  {
    q: "Can I backtest AI trading strategies?",
    a: "Yes. StockAI includes an institutional-grade backtester with Sharpe, Sortino, Calmar, profit factor, Monte Carlo simulations and walk-forward analysis.",
  },
];

const Landing = () => {
  const navigate = useNavigate();
  const [signalCount, setSignalCount] = useState<number | null>(null);

  useEffect(() => {
    const fetchCount = async () => {
      const { count } = await supabase
        .from("live_signals")
        .select("*", { count: "exact", head: true })
        .gte("expires_at", new Date().toISOString());
      if (count !== null) setSignalCount(count);
    };
    fetchCount();
  }, []);

  const features = [
    {
      icon: Brain,
      title: "AI Market Scanner",
      description: "Quantitative analysis of 6,000+ stocks using 10+ technical indicators, regime detection, and weighted signal consensus.",
    },
    {
      icon: Target,
      title: "Portfolio Tracking",
      description: "Register trades, track P&L in real-time, monitor win rate, profit factor, and equity curves with drawdown analysis.",
    },
    {
      icon: BarChart3,
      title: "Strategy Backtesting",
      description: "Test strategies against historical data with Monte Carlo simulations, Sharpe ratios, and benchmark comparisons.",
    },
  ];

  const stats = [
    { label: "Technical Indicators", value: "10+" },
    { label: "Stocks Scanned", value: "6,000+" },
    { label: "Conviction Range", value: "35–92%" },
    { label: "Regime Detection", value: "Active" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO
        title="StockAI — AI Stock Predictions, Signals & Screener"
        description="StockAI scans 6,000+ tickers in real time, generates calibrated AI trading signals, and lets you backtest every strategy. Research and paper-trading platform."
        path="/"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "StockAI",
            applicationCategory: "FinanceApplication",
            operatingSystem: "Web",
            url: "https://usestockai.lovable.app/",
            description:
              "AI-powered stock prediction and signals platform with real-time scanning of 6,000+ tickers, high-conviction trade signals, strategy backtesting, and paper-trading portfolio tracking.",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQS.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          },
        ]}
      />
      <Navbar />
      
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/3 rounded-full blur-[120px]" />
        
        <div className="container mx-auto px-6 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-3xl mx-auto"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="flex justify-center mb-10"
            >
              <Logo size="lg" />
            </motion.div>
            
            {/* Live Signal Badge */}
            {signalCount !== null && signalCount > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="flex justify-center mb-6"
              >
                <Badge variant="outline" className="gap-1.5 px-3 py-1 text-xs border-success/30 text-success">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  {signalCount} active signal{signalCount !== 1 ? "s" : ""} right now
                </Badge>
              </motion.div>
            )}
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-medium mb-6 leading-tight tracking-tight">
              AI Stock Predictions
              <br />
              <span className="text-gradient">& Live Trading Signals</span>
            </h1>
            
            <p className="text-lg text-muted-foreground mb-12 max-w-xl mx-auto leading-relaxed">
              StockAI scans 6,000+ tickers in real time, generates high-conviction AI stock signals
              with calibrated confidence, and lets you backtest every strategy. Research only — no noise.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                variant="glow"
                size="xl"
                onClick={() => navigate("/dashboard")}
                className="group"
              >
                <TrendingUp className="w-5 h-5" />
                Open Dashboard
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>
          </motion.div>

          {/* Stats Bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="flex flex-wrap justify-center gap-6 sm:gap-10 mt-16"
          >
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 + i * 0.05 }}
                className="text-center"
              >
                <div className="text-lg sm:text-xl font-bold font-mono text-primary">{stat.value}</div>
                <div className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">{stat.label}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-2xl sm:text-3xl font-medium mb-3">Everything You Need</h2>
            <p className="text-sm text-muted-foreground max-w-lg mx-auto">
              A complete trading intelligence platform — from signal discovery to portfolio performance tracking.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="glass-card p-6 h-full hover:border-primary/20 transition-colors">
                  <feature.icon className="w-8 h-8 text-primary mb-4" />
                  <h3 className="text-base font-medium mb-2">{feature.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24 bg-secondary/20">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-2xl sm:text-3xl font-medium mb-3">How It Works</h2>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-8 max-w-4xl mx-auto">
            {[
              { step: "01", icon: Eye, title: "Scan", desc: "AI scans 6,000+ stocks across all market sectors" },
              { step: "02", icon: Zap, title: "Signal", desc: "High-conviction buy/sell signals with reasoning" },
              { step: "03", icon: LineChart, title: "Track", desc: "Register trades and monitor real-time P&L" },
              { step: "04", icon: PieChart, title: "Optimize", desc: "Backtest strategies and improve over time" },
            ].map((item, i) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="text-center"
              >
                <div className="text-[10px] font-mono text-primary/60 mb-2">{item.step}</div>
                <item.icon className="w-6 h-6 text-primary mx-auto mb-3" />
                <h3 className="text-sm font-medium mb-1">{item.title}</h3>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24 bg-secondary/20">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-2xl sm:text-3xl font-medium mb-3">Frequently Asked Questions</h2>
          </motion.div>
          <div className="space-y-6">
            {FAQS.map((f, i) => (
              <motion.div
                key={f.q}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className="glass-card p-6">
                  <h3 className="text-base font-medium mb-2">{f.q}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.a}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="container mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-2xl sm:text-3xl font-medium mb-4">Ready to Trade Smarter?</h2>
            <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto">
              Join StockAI and start making data-driven trading decisions with AI-powered market intelligence.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button variant="glow" size="xl" onClick={() => navigate("/auth?mode=signup")} className="group">
                Get Started Free
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Button>
              <Button variant="outline" size="xl" onClick={() => navigate("/dashboard")}>
                <Activity className="w-4 h-4" />
                View Dashboard
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Landing;
