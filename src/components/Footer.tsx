import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { LaunchLlamaBadge } from "./LaunchLlamaBadge";

const COLUMNS: { heading: string; links: { to: string; label: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { to: "/dashboard", label: "Dashboard" },
      { to: "/stocks", label: "Forecasts" },
      { to: "/performance", label: "Track Record" },
      { to: "/pricing", label: "Pricing" },
    ],
  },
  {
    heading: "Learn",
    links: [
      { to: "/guides", label: "All Guides" },
      { to: "/ai-stock-trading", label: "AI Stock Trading" },
      { to: "/guides/ai-trading-bots", label: "AI Trading Bots" },
      { to: "/guides/backtest-trading-strategy", label: "Backtesting" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { to: "/terms", label: "Terms" },
      { to: "/privacy", label: "Privacy" },
      { to: "/disclosure", label: "Risk Disclosure" },
      { to: "/security", label: "Security" },
    ],
  },
];

export const Footer = () => {
  return (
    <footer className="border-t border-border/40 bg-background mt-auto pb-20 md:pb-0">
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-7xl">
        <div className="grid gap-8 sm:grid-cols-3 mb-10">
          {COLUMNS.map((col) => (
            <nav key={col.heading} aria-label={col.heading} className="space-y-3">
              <h2 className="text-xs uppercase tracking-widest text-foreground/80">{col.heading}</h2>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Disclaimer */}
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

        <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} StockAI. Paper trading & market research.
          </p>
          <LaunchLlamaBadge />
        </div>
      </div>
    </footer>
  );
};
