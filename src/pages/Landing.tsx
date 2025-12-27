import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { 
  TrendingUp, 
  Brain, 
  Shield, 
  Zap, 
  BarChart3,
  ArrowRight,
  Sparkles,
  LineChart,
  Activity
} from "lucide-react";

const Landing = () => {
  const navigate = useNavigate();

  const features = [
    {
      icon: Brain,
      title: "Ensemble AI Models",
      description: "Combines Transformer, LSTM, and XGBoost models with Monte Carlo Dropout for robust uncertainty estimation.",
    },
    {
      icon: LineChart,
      title: "Technical Analysis",
      description: "Automatic calculation of EMA, SMA, RSI, MACD, Bollinger Bands, and volatility indicators.",
    },
    {
      icon: Activity,
      title: "Regime Detection",
      description: "Hidden Markov Model identifies bullish, bearish, neutral, or volatile market regimes.",
    },
    {
      icon: Sparkles,
      title: "Sentiment Analysis",
      description: "Optional NewsAPI integration with VADER sentiment scoring for market sentiment insights.",
    },
    {
      icon: Shield,
      title: "Explainability",
      description: "Full transparency with feature importance rankings and confidence intervals.",
    },
    {
      icon: Zap,
      title: "Real-time Data",
      description: "Live data ingestion from Yahoo Finance with instant technical indicator computation.",
    },
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Hero Section */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 bg-gradient-hero" />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        
        <div className="container mx-auto px-4 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center max-w-4xl mx-auto"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="flex justify-center mb-8"
            >
              <Logo size="lg" />
            </motion.div>
            
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
              <span className="text-foreground">AI-Powered</span>{" "}
              <span className="text-gradient">Stock Predictions</span>
              <br />
              <span className="text-muted-foreground">with Explainability</span>
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
              Advanced machine learning ensemble combining Transformers, LSTM, and XGBoost 
              with uncertainty quantification and full model transparency.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                variant="glow"
                size="xl"
                onClick={() => navigate("/dashboard")}
                className="group"
              >
                <TrendingUp className="w-5 h-5" />
                Start Predicting
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Button>
              <Button
                variant="outline"
                size="xl"
                onClick={() => navigate("/auth")}
              >
                Sign In to Save History
              </Button>
            </div>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.8 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-20 max-w-4xl mx-auto"
          >
            {[
              { label: "Model Types", value: "3" },
              { label: "Technical Indicators", value: "12+" },
              { label: "Uncertainty Quantification", value: "MC" },
              { label: "Sentiment Sources", value: "News" },
            ].map((stat, index) => (
              <div
                key={stat.label}
                className="glass-card p-4 text-center"
              >
                <div className="text-2xl md:text-3xl font-bold text-primary font-mono">
                  {stat.value}
                </div>
                <div className="text-xs md:text-sm text-muted-foreground mt-1">
                  {stat.label}
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 relative">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Powered by Advanced <span className="text-gradient">Machine Learning</span>
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Our ensemble approach combines multiple state-of-the-art models 
              with rigorous uncertainty estimation for reliable predictions.
            </p>
          </motion.div>

          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <motion.div
                  key={feature.title}
                  variants={itemVariants}
                  className="glass-card p-6 group hover:-translate-y-1 transition-transform duration-300"
                >
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm">{feature.description}</p>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 relative">
        <div className="absolute inset-0 bg-gradient-to-t from-primary/5 to-transparent" />
        <div className="container mx-auto px-4 relative z-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="glass-card p-8 md:p-12 text-center max-w-3xl mx-auto"
          >
            <BarChart3 className="w-12 h-12 text-primary mx-auto mb-6" />
            <h2 className="text-2xl md:text-3xl font-bold mb-4">
              Ready to Make Informed Decisions?
            </h2>
            <p className="text-muted-foreground mb-8">
              Get AI-powered stock predictions with confidence intervals 
              and full model explainability. No credit card required.
            </p>
            <Button
              variant="glow"
              size="xl"
              onClick={() => navigate("/dashboard")}
            >
              <Sparkles className="w-5 h-5" />
              Try GodStockAI Now
            </Button>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Logo size="sm" />
            <p className="text-sm text-muted-foreground text-center">
              © {new Date().getFullYear()} GodStockAI. For educational purposes only. Not financial advice.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
