import { Link } from "react-router-dom";
import { GuideLayout } from "@/components/GuideLayout";

const AiStockTradingForBeginners = () => (
  <GuideLayout
    path="/guides/ai-stock-trading-for-beginners"
    kicker="Guide · Beginners"
    title="AI Stock Trading for Beginners"
    metaTitle="AI Stock Trading for Beginners: A Practical First-90-Days Plan"
    metaDescription="A jargon-free beginner's guide to AI stock trading: what the terms mean, how to paper trade a signal feed, and a 90-day plan before you risk any real money."
    intro={
      <>
        If you have never traded systematically before, the hardest part is not the technology — it is
        resisting the urge to skip straight to live money. This is a plain-language walkthrough plus a
        90-day sequence that puts evidence before capital.
      </>
    }
    sections={[
      {
        id: "vocabulary",
        heading: "The eight words you actually need",
        body: (
          <ul className="space-y-2 list-disc pl-5">
            <li><span className="text-foreground">Signal</span> — a model's suggestion to buy or sell a specific ticker, with a price and a reason attached.</li>
            <li><span className="text-foreground">Conviction</span> — how confident the model is, usually 0–100. Only useful if calibrated.</li>
            <li><span className="text-foreground">Position size</span> — how much money goes into one trade. The single biggest driver of your results.</li>
            <li><span className="text-foreground">Stop loss</span> — the price at which you accept you were wrong and exit.</li>
            <li><span className="text-foreground">Take profit</span> — the price at which you bank the gain.</li>
            <li><span className="text-foreground">Drawdown</span> — how far your account has fallen from its peak. The number that actually makes people quit.</li>
            <li><span className="text-foreground">Backtest</span> — running the strategy on historical data to see how it would have behaved.</li>
            <li><span className="text-foreground">Paper trading</span> — trading the signals with fake money, in real time, to verify the edge.</li>
          </ul>
        ),
      },
      {
        id: "plan",
        heading: "The 90-day plan",
        body: (
          <>
            <p>
              <span className="text-foreground">Days 1–14 — Observe.</span> Do not trade. Watch the
              signal feed daily and write down what you would have done. Get used to seeing setups fail
              without concluding the system is broken.
            </p>
            <p>
              <span className="text-foreground">Days 15–30 — Backtest.</span> Run the strategy over
              several market conditions with costs enabled. Note the worst drawdown and ask honestly
              whether you would have kept going through it.
            </p>
            <p>
              <span className="text-foreground">Days 31–75 — Paper trade.</span> Take every qualifying
              signal at a consistent size for at least thirty trades. Compare your realized win rate to
              the conviction scores the model published.
            </p>
            <p>
              <span className="text-foreground">Days 76–90 — Go live small.</span> A quarter of your
              intended size. You are testing your own execution and psychology, not the model.
            </p>
          </>
        ),
      },
      {
        id: "mistakes",
        heading: "Beginner mistakes that cost the most",
        body: (
          <ul className="space-y-2 list-disc pl-5">
            <li>Taking only the signals that "feel right" — this reintroduces exactly the bias the model exists to remove.</li>
            <li>Widening a stop because the trade is close to it. The stop was the plan.</li>
            <li>Sizing up after a winning streak and sizing down after losses, which inverts the maths.</li>
            <li>Holding eight positions in one sector and calling it diversification.</li>
            <li>Judging a system on ten trades. Thirty is a minimum; a hundred is meaningful.</li>
          </ul>
        ),
      },
      {
        id: "next",
        heading: "Where to start today",
        body: (
          <p>
            Read the{" "}
            <Link to="/ai-stock-trading" className="text-primary hover:underline">complete AI stock trading guide</Link>{" "}
            for how the engine works, then open the{" "}
            <Link to="/dashboard" className="text-primary hover:underline">live dashboard</Link> and simply
            watch it for two weeks. Free, no capital, and it will teach you more than any course.
          </p>
        ),
      },
    ]}
    faqs={[
      {
        q: "Can a complete beginner use AI stock trading?",
        a: "Yes, but the platform does not remove the need to understand risk. A beginner who paper trades for a month, sizes conservatively, and never overrides a stop will do better than an experienced trader who ignores those rules.",
      },
      {
        q: "How much money do I need to start AI stock trading?",
        a: "Enough for costs to be a small fraction of each trade and for several positions at once — realistically a few thousand dollars for short-horizon strategies. Below that, fees and share-rounding erode most of the edge.",
      },
      {
        q: "Should I automate trades right away?",
        a: "No. Paper trade first, then trade manually from the signal feed, then automate once you have seen the system behave through at least one losing streak. Automating a system you do not yet trust means you will switch it off at the worst moment.",
      },
      {
        q: "Is AI stock trading safe for beginners?",
        a: "Trading is never safe in the sense of guaranteed. It is manageable: cap what you risk per trade, keep the total account exposure modest, and treat the first months as tuition rather than income.",
      },
    ]}
    related={[
      { href: "/ai-stock-trading", title: "AI stock trading: complete guide", body: "The full mechanics, start to finish." },
      { href: "/guides/does-ai-stock-trading-work", title: "Does it actually work?", body: "The evidence and the honest caveats." },
      { href: "/guides/ai-stock-signals-explained", title: "AI stock signals explained", body: "What each field on a signal card means." },
      { href: "/guides/backtest-trading-strategy", title: "How to backtest", body: "Your day 15–30 homework." },
    ]}
  />
);

export default AiStockTradingForBeginners;
