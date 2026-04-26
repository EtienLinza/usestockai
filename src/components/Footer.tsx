import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";

export const Footer = () => {
  return (
    <footer className="border-t border-border/40 bg-background mt-auto">
      <div className="container mx-auto px-6 py-8 max-w-7xl">
        {/* Disclaimer banner */}
        <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/30 border border-border/40 mb-6">
          <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">Not financial advice.</span>{" "}
            StockAI is a research and paper-trading simulation platform. All signals,
            backtests, and virtual positions are for informational purposes only. No real
            trades are executed. Trading involves risk of loss — see our{" "}
            <Link to="/disclosure" className="underline hover:text-foreground transition-colors">
              risk disclosure
            </Link>
            .
          </p>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} StockAI. Paper trading & market research.
          </p>
          <nav className="flex items-center gap-6 text-xs">
            <Link
              to="/terms"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Terms
            </Link>
            <Link
              to="/privacy"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Privacy
            </Link>
            <Link
              to="/disclosure"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Risk Disclosure
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
};
