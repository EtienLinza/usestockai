import { Link } from "react-router-dom";
import { GuideLayout } from "@/components/GuideLayout";

const AiVsHumanTraders = () => (
  <GuideLayout
    path="/guides/ai-vs-human-traders"
    kicker="Guide · Comparison"
    title="AI vs Human Traders: Who Wins, and at What"
    metaTitle="AI vs Human Traders: Strengths, Weaknesses & the Hybrid Approach"
    metaDescription="AI vs human traders compared honestly — where models beat discretion, where judgement still wins, and how to combine both without reintroducing bias."
    intro={
      <>
        This is not a contest with one winner. Models and humans fail in completely different ways, and
        the practical question is which decisions to hand over and which to keep.
      </>
    }
    sections={[
      {
        id: "machine-wins",
        heading: "Where the machine wins",
        body: (
          <ul className="space-y-2 list-disc pl-5">
            <li><span className="text-foreground">Breadth.</span> Thousands of tickers scored to the same standard, every session, without fatigue.</li>
            <li><span className="text-foreground">Consistency.</span> The same setup gets the same verdict on a good day and a bad one.</li>
            <li><span className="text-foreground">Arithmetic.</span> Volatility-scaled sizing and correlation accounting are computations, not intuitions.</li>
            <li><span className="text-foreground">Exit discipline.</span> No model ever moved a stop because it was emotionally attached to a position.</li>
            <li><span className="text-foreground">Memory.</span> Every past trade is labelled and fed back into calibration, rather than selectively remembered.</li>
          </ul>
        ),
      },
      {
        id: "human-wins",
        heading: "Where the human still wins",
        body: (
          <ul className="space-y-2 list-disc pl-5">
            <li><span className="text-foreground">Novel events.</span> A regulatory shock or a first-of-its-kind news event has no training data behind it.</li>
            <li><span className="text-foreground">Context.</span> Understanding that a merger, a lawsuit, or a product recall breaks the statistical relationship the model relies on.</li>
            <li><span className="text-foreground">Knowing when to stop.</span> Deciding that conditions are unusual enough to reduce exposure entirely is a judgement call.</li>
            <li><span className="text-foreground">Goal setting.</span> Risk tolerance, time horizon, and what a portfolio is actually for are not model outputs.</li>
          </ul>
        ),
      },
      {
        id: "failure-modes",
        heading: "How each side fails",
        body: (
          <>
            <p>
              Humans fail through bias: holding losers, cutting winners, revenge trading after a loss,
              overtrading out of boredom, and remembering their wins more clearly than their losses.
              These failures are consistent, well documented, and expensive.
            </p>
            <p>
              Models fail through brittleness: confidently applying learned relationships in conditions
              where those relationships no longer hold, and doing so at full size across many positions
              simultaneously. A human's bad day costs one trade; a model's bad assumption costs the whole
              book at once. Which is exactly why hard risk caps matter more than clever features.
            </p>
          </>
        ),
      },
      {
        id: "hybrid",
        heading: "The hybrid that actually works",
        body: (
          <>
            <p>
              Give the model the mechanical decisions: what to scan, how to rank, how large to size, and
              where to exit. Keep for yourself the structural ones: how much total capital is at risk,
              which sectors or event-driven names to exclude entirely, and when to stand down.
            </p>
            <p>
              The rule that preserves the edge: you may veto a trade for a structural reason, but you may
              never upgrade one. Overriding upward is how discretion quietly becomes the strategy again.
              Read the{" "}
              <Link to="/ai-stock-trading" className="text-primary hover:underline">full AI stock trading guide</Link>{" "}
              for how the mechanical side is built.
            </p>
          </>
        ),
      },
    ]}
    faqs={[
      {
        q: "Will AI replace human traders?",
        a: "It has already replaced most manual execution and much of the screening work. It has not replaced judgement about risk appetite, novel events, or portfolio purpose, and there is no sign that it will soon.",
      },
      {
        q: "Do AI traders beat human traders?",
        a: "On consistency and coverage, comfortably. On adapting to genuinely unprecedented events, no. Over long periods, a disciplined system typically beats an undisciplined human and loses to a disciplined human who also uses systems.",
      },
      {
        q: "Should I override my AI trading signals?",
        a: "Only downward. Skipping a trade for a concrete structural reason — pending earnings, a takeover, a halt — is legitimate. Increasing size because you like the story reintroduces exactly the bias the system exists to remove.",
      },
      {
        q: "Can AI trading remove emotion completely?",
        a: "It removes emotion from the individual trade decisions, not from you. Most system failures are the operator switching the system off during a drawdown, which is why paper trading through a losing streak is essential before going live.",
      },
    ]}
    related={[
      { href: "/ai-stock-trading", title: "AI stock trading: complete guide", body: "The mechanical half of the hybrid." },
      { href: "/guides/how-accurate-are-ai-stock-predictions", title: "How accurate are AI predictions?", body: "Calibration, accuracy, and what to trust." },
      { href: "/guides/ai-trading-bots", title: "AI trading bots", body: "When to hand over execution entirely." },
      { href: "/guides/ai-stock-trading-for-beginners", title: "Beginner's path", body: "A 90-day plan before real capital." },
    ]}
  />
);

export default AiVsHumanTraders;
