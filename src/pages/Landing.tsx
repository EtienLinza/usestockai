import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { ArrowRight, TrendingUp, Brain, Zap } from "lucide-react";

const Landing = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        {/* Subtle background glow */}
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
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-medium mb-6 leading-tight tracking-tight">
              AI-Powered
              <br />
              <span className="text-gradient">Market Intelligence</span>
            </h1>
            
            <p className="text-lg text-muted-foreground mb-12 max-w-xl mx-auto leading-relaxed">
              Advanced predictions with confidence intervals and full transparency.
              Intelligence only. No trading. No noise.
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

          {/* Minimal features */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-24 max-w-3xl mx-auto"
          >
            {[
              { icon: Brain, label: "AI Analysis", desc: "Real-time predictions" },
              { icon: Zap, label: "Live Data", desc: "Up-to-date market info" },
              { icon: TrendingUp, label: "Confidence", desc: "Uncertainty quantified" },
            ].map((item, index) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + index * 0.1 }}
                className="text-center p-6"
              >
                <item.icon className="w-6 h-6 text-primary mx-auto mb-3" />
                <h3 className="text-sm font-medium mb-1">{item.label}</h3>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 border-t border-border/30">
        <div className="container mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Logo size="sm" />
            <p className="text-xs text-muted-foreground text-center">
              © {new Date().getFullYear()} StockAI. Intelligence only. Not financial advice.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;