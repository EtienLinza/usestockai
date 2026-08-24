import { Link } from "react-router-dom";
import { GuideLayout } from "@/components/GuideLayout";

const AiStockTradingSoftware = () => (
  <GuideLayout
    path="/guides/ai-stock-trading-software"
    kicker="Guide · Tools"
    title="AI Stock Trading Software: What to Look For"
    metaTitle="AI Stock Trading Software: How to Choose (2026 Buyer's Guide)"
    metaDescription="A buyer's guide to AI stock trading software — the features that matter, the red flags that don't, and a scoring checklist you can apply to any platform."
    intro={
      <>
        Most comparison articles rank platforms by price and screenshot count. That tells you nothing
        about whether the software will make or lose you money. Here is the checklist that does.
      </>
    }
    sections={[
      {
        id: "categories",
        heading: "The four categories of software",
        body: (
          <>
            <p>
              <span className="text-foreground">Screeners</span> filter a universe on static criteria.
              Cheap, useful, no probability attached.
            </p>
            <p>
              <span className="text-foreground">Signal engines</span> score candidates and publish
              ranked buy/sell ideas with entries, stops, and targets. You execute manually.
            </p>
            <p>
              <span className="text-foreground">Backtesters</span> replay a strategy over history with
              costs and slippage modelled, producing risk-adjusted statistics.
            </p>
            <p>
              <span className="text-foreground">Automated execution</span> connects a signal engine to a
              broker and trades without you. Highest convenience, highest blow-up risk if the risk
              controls are weak.
            </p>
            <p>
              Serious platforms combine at least the middle two, because a signal you cannot backtest is
              an opinion.
            </p>
          </>
        ),
      },
      {
        id: "must-have",
        heading: "Non-negotiable features",
        body: (
          <ul className="space-y-2 list-disc pl-5">
            <li><span className="text-foreground">Cost-aware backtesting</span> — commissions, spread, and slippage switched on by default, not as an afterthought.</li>
            <li><span className="text-foreground">Out-of-sample and walk-forward testing</span> — proof the parameters were not fitted to the test period.</li>
            <li><span className="text-foreground">Calibrated conviction</span> — the platform should show how its scores map to realized win rates.</li>
            <li><span className="text-foreground">Hard risk limits</span> — maximum stop distance, maximum single-position size, correlation and sector caps.</li>
            <li><span className="text-foreground">A complete public trade log</span> — every trade, including the ugly ones, with timestamps.</li>
            <li><span className="text-foreground">Paper trading</span> — a real-time dry run before capital.</li>
            <li><span className="text-foreground">Data export</span> — if you cannot get your history out as CSV, you cannot audit it.</li>
          </ul>
        ),
      },
      {
        id: "red-flags",
        heading: "Red flags",
        body: (
          <ul className="space-y-2 list-disc pl-5">
            <li>Guaranteed or "expected" monthly returns.</li>
            <li>Results shown as screenshots or equity curves with no underlying trade list.</li>
            <li>No mention of maximum drawdown anywhere in the marketing.</li>
            <li>A backtest that starts conveniently at the bottom of a bear market.</li>
            <li>Win rates above 90% — usually achieved by never cutting losers.</li>
            <li>Methodology described purely as "proprietary AI" with no detail at all.</li>
          </ul>
        ),
      },
      {
        id: "scoring",
        heading: "A simple scoring method",
        body: (
          <>
            <p>
              Score each candidate platform out of 14: two points each for cost-aware backtesting,
              out-of-sample testing, calibration evidence, explicit risk limits, a public trade log,
              paper trading, and data export. Below 10, keep looking. This is deliberately boring —
              boring is what survives a drawdown.
            </p>
            <p>
              You can check StockAI against the same list: the{" "}
              <Link to="/backtest" className="text-primary hover:underline">backtester</Link> models costs,
              the{" "}
              <Link to="/performance" className="text-primary hover:underline">track record page</Link> is
              public, and the methodology is written up in the{" "}
              <Link to="/ai-stock-trading" className="text-primary hover:underline">main guide</Link>.
            </p>
          </>
        ),
      },
    ]}
    faqs={[
      {
        q: "What is the best AI stock trading software?",
        a: "There is no universal best. Match the software to your timeframe and capital, then score it on cost-aware backtesting, out-of-sample validation, calibration evidence, explicit risk limits, a public trade log, paper trading, and data export.",
      },
      {
        q: "Is there free AI stock trading software?",
        a: "Free tiers generally provide signals, screening, and paper trading; automated live execution and deep backtesting are usually paid. That order is sensible anyway — verify the edge before paying for automation of it.",
      },
      {
        q: "Do I need coding skills to use AI trading software?",
        a: "No for signal engines and hosted backtesters. Yes if you want to write custom strategies against an API. Most retail users never need to write a line of code.",
      },
      {
        q: "Can AI trading software connect to my broker?",
        a: "Some platforms offer broker integrations for automated execution. Treat that as an advanced step: run the same strategy in paper mode first and confirm your real fills resemble the simulated ones.",
      },
    ]}
    related={[
      { href: "/ai-stock-trading", title: "AI stock trading: complete guide", body: "The mechanics behind every platform on your shortlist." },
      { href: "/guides/ai-trading-bots", title: "AI trading bots", body: "The automated-execution end of the market." },
      { href: "/guides/backtest-trading-strategy", title: "Backtesting a strategy", body: "How to use the most important feature properly." },
      { href: "/guides/does-ai-stock-trading-work", title: "Does it work?", body: "Set your expectations before you buy anything." },
    ]}
  />
);

export default AiStockTradingSoftware;
