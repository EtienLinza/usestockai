import { Link } from "react-router-dom";
import { GuideLayout } from "@/components/GuideLayout";

const DoesAiStockTradingWork = () => (
  <GuideLayout
    path="/guides/does-ai-stock-trading-work"
    kicker="Guide · Evidence"
    title="Does AI Stock Trading Actually Work?"
    metaTitle="Does AI Stock Trading Work? An Honest, Evidence-Based Answer"
    metaDescription="Does AI stock trading work? What model-driven trading can realistically deliver, where the edge disappears, and the tests that separate a real system from marketing."
    intro={
      <>
        Short answer: yes, narrowly, and far less dramatically than the advertising suggests. Model-driven
        trading produces small, repeatable probability edges. It does not produce certainty, and any
        system claiming otherwise is selling something.
      </>
    }
    sections={[
      {
        id: "what-works",
        heading: "What demonstrably works",
        body: (
          <>
            <p>
              Systematic trading is not fringe — it is how the majority of institutional order flow is
              already generated. The parts that reliably transfer to retail scale are the unglamorous
              ones: exhaustive scanning, consistent scoring, volatility-scaled position sizing, and
              mechanical exits. None of these require predicting the future. They require applying the
              same standard to every candidate and never negotiating with a stop.
            </p>
            <p>
              A realistic well-built engine wins somewhere between 50% and 60% of its trades with an
              average winner larger than its average loser. That combination compounds. It also produces
              long losing streaks that feel like the system is broken when it is functioning exactly as
              designed.
            </p>
          </>
        ),
      },
      {
        id: "what-fails",
        heading: "What reliably fails",
        body: (
          <>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <span className="text-foreground">Backtests without costs.</span> Commissions, spread,
                and slippage routinely convert a "profitable" short-horizon strategy into a losing one.
              </li>
              <li>
                <span className="text-foreground">Overfitted parameter sets.</span> A strategy tuned to
                one specific ticker across one specific bull run learns the history, not the market.
              </li>
              <li>
                <span className="text-foreground">Mis-calibrated conviction.</span> If a score of 85
                does not actually win more often than a 65, sizing off that score is worse than sizing
                everything equally.
              </li>
              <li>
                <span className="text-foreground">Unbounded stops.</span> One overnight gap through a
                wide stop can erase a quarter of accumulated gains.
              </li>
            </ul>
          </>
        ),
      },
      {
        id: "test",
        heading: "How to test the claim yourself",
        body: (
          <>
            <p>
              Do not accept a returns chart. Demand four things, in order: an out-of-sample backtest
              covering a bull market, a correction, and a flat stretch; a complete trade log with losers
              included; calibration evidence showing high-conviction trades really do resolve better; and
              a stated maximum drawdown.
            </p>
            <p>
              You can run the first test on StockAI yourself with{" "}
              <Link to="/backtest" className="text-primary hover:underline">the backtester</Link>, and
              inspect the third on the{" "}
              <Link to="/performance" className="text-primary hover:underline">public track record page</Link>.
            </p>
          </>
        ),
      },
      {
        id: "verdict",
        heading: "The honest verdict",
        body: (
          <p>
            AI stock trading works as a discipline-enforcement and coverage tool with a modest
            statistical edge attached. It does not work as a money machine, and it does not remove the
            possibility of a losing year. If you would not accept a 20% drawdown on the way to a good
            outcome, no model will change that arithmetic for you.
          </p>
        ),
      },
    ]}
    faqs={[
      {
        q: "What win rate should I expect from AI stock trading?",
        a: "Typically 50–60% for a swing-horizon system. Anything advertised above roughly 70% sustained should be treated as a red flag until you have seen a full trade log, because high win rates are usually purchased with catastrophic loss tails.",
      },
      {
        q: "Can AI stock trading beat the S&P 500?",
        a: "Sometimes, over some periods, after costs — and often with higher volatility and deeper drawdowns than simply holding an index fund. The relevant comparison is risk-adjusted return, not raw return, which is why Sharpe and Sortino ratios matter more than headline percentages.",
      },
      {
        q: "Why did my AI trading bot stop working?",
        a: "Almost always regime change or drift. A model trained on a trending market underperforms in a choppy one. Systems that survive re-calibrate continuously against realized outcomes and reduce position size when realized results diverge from expectations.",
      },
      {
        q: "Is AI trading better than manual trading?",
        a: "It is more consistent, not necessarily more skilful. A disciplined manual trader with a written plan can outperform a mediocre model. What automation reliably removes is the emotional decision-making that damages most retail accounts.",
      },
    ]}
    related={[
      { href: "/ai-stock-trading", title: "AI stock trading: complete guide", body: "How these engines scan, score, size and exit." },
      { href: "/guides/how-accurate-are-ai-stock-predictions", title: "How accurate are AI stock predictions?", body: "What accuracy means when the output is a probability." },
      { href: "/guides/ai-trading-bots", title: "AI trading bots", body: "Automation mechanics and how to spot a fake edge." },
      { href: "/guides/backtest-trading-strategy", title: "Backtesting a strategy", body: "Run the tests described above yourself." },
    ]}
  />
);

export default DoesAiStockTradingWork;
