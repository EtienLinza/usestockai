import { Link } from "react-router-dom";
import { GuideLayout } from "@/components/GuideLayout";

const HowAccurateAreAiStockPredictions = () => (
  <GuideLayout
    path="/guides/how-accurate-are-ai-stock-predictions"
    kicker="Guide · Accuracy"
    title="How Accurate Are AI Stock Predictions?"
    metaTitle="How Accurate Are AI Stock Predictions? What the Numbers Mean"
    metaDescription="How accurate AI stock predictions really are, why calibration matters more than accuracy, and how to verify a platform's claimed hit rate for yourself."
    intro={
      <>
        "Accuracy" is the wrong question, asked constantly. A model that is right 55% of the time can be
        highly profitable, and a model that is right 85% of the time can bankrupt you. What matters is
        whether the stated probability matches reality — calibration — and what happens on the trades it
        gets wrong.
      </>
    }
    sections={[
      {
        id: "accuracy-vs-calibration",
        heading: "Accuracy versus calibration",
        body: (
          <>
            <p>
              Accuracy is the share of predictions that turn out correct. Calibration is whether an
              80%-confidence prediction is actually right about 80% of the time. Calibration is the more
              useful property, because position sizing depends on it: if the score is honest, you can
              risk more on high-conviction setups and less on marginal ones, and the maths works in your
              favour over hundreds of trades.
            </p>
            <p>
              When calibration inverts — when the 80s bucket underperforms the 65s — sizing off
              conviction actively destroys money. This is a common and largely invisible failure, which
              is why any platform worth using publishes its score-to-outcome mapping.
            </p>
          </>
        ),
      },
      {
        id: "realistic",
        heading: "Realistic accuracy ranges",
        body: (
          <>
            <p>
              For swing-horizon equity signals, a genuine, cost-aware system typically resolves
              favourably 50–60% of the time. Intraday systems can run higher hit rates with much smaller
              average wins. Long-horizon allocation models can run lower hit rates with much larger ones.
              None of those numbers mean anything without the accompanying payoff ratio and drawdown.
            </p>
            <p>
              Two systems both at 55% accuracy can be opposites: one with an average winner 1.8× its
              average loser compounds nicely; one with an average winner 0.6× its average loser bleeds
              out. Always ask for both numbers together.
            </p>
          </>
        ),
      },
      {
        id: "horizon",
        heading: "Accuracy decays with horizon",
        body: (
          <p>
            Prediction quality is strongest over the horizon the model was trained on and degrades
            quickly outside it. A model tuned for a five-day move tells you very little about the same
            stock six months out. This is also why holding a trade "just a bit longer" past its intended
            horizon is one of the most reliable ways to convert a statistical edge into a coin flip.
          </p>
        ),
      },
      {
        id: "verify",
        heading: "How to verify a claimed hit rate",
        body: (
          <>
            <p>
              Ask for the raw trade list, group it by the model's stated conviction band, and compute the
              realized win rate per band. If the bands are monotonic — higher conviction, higher win rate
              — the score is trustworthy. If they are flat or inverted, ignore the score entirely and
              trade flat-sized.
            </p>
            <p>
              StockAI publishes signal-level data on the{" "}
              <Link to="/performance" className="text-primary hover:underline">track record page</Link>, and
              you can reproduce the same analysis on historical data with the{" "}
              <Link to="/backtest" className="text-primary hover:underline">backtester</Link>.
            </p>
          </>
        ),
      },
    ]}
    faqs={[
      {
        q: "How accurate are AI stock predictions?",
        a: "Well-built swing-horizon systems resolve favourably around 50–60% of the time after costs. Claims materially above that, sustained, usually hide a strategy that wins often and loses catastrophically.",
      },
      {
        q: "Can AI predict stock prices exactly?",
        a: "No. Prices are driven partly by information that does not exist yet. Models estimate probabilities over ranges, not point values, and any tool quoting an exact future price is presenting a scenario, not a prediction.",
      },
      {
        q: "What is a good confidence score in AI trading?",
        a: "It depends entirely on the platform's scale and calibration. A score is only meaningful if the publisher shows what realized win rate each band historically produced — otherwise the number is decoration.",
      },
      {
        q: "Why do AI predictions get worse over time?",
        a: "Market regimes shift and the relationships a model learned weaken — this is called drift. Robust systems detect drift, re-calibrate against recent outcomes, and cut position size when realized results diverge from expectations.",
      },
    ]}
    related={[
      { href: "/ai-stock-trading", title: "AI stock trading: complete guide", body: "How conviction scores are produced in the first place." },
      { href: "/guides/does-ai-stock-trading-work", title: "Does AI stock trading work?", body: "The evidence behind the accuracy numbers." },
      { href: "/guides/ai-stock-signals-explained", title: "AI stock signals explained", body: "Reading a signal card field by field." },
      { href: "/guides/ai-vs-human-traders", title: "AI vs human traders", body: "Where each side genuinely wins." },
    ]}
  />
);

export default HowAccurateAreAiStockPredictions;
