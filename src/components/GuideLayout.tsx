import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const SITE = "https://usestockai.lovable.app";

export interface GuideFaq {
  q: string;
  a: string;
}

export interface GuideSection {
  id: string;
  heading: string;
  body: ReactNode;
}

interface GuideLayoutProps {
  path: string;
  kicker: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  intro: ReactNode;
  datePublished?: string;
  sections: GuideSection[];
  faqs?: GuideFaq[];
  related?: { href: string; title: string; body: string }[];
}

export const GuideLayout = ({
  path,
  kicker,
  title,
  metaTitle,
  metaDescription,
  intro,
  datePublished = "2026-08-23",
  sections,
  faqs = [],
  related = [],
}: GuideLayoutProps) => {
  const jsonLd: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: title,
      description: metaDescription,
      author: { "@type": "Organization", name: "StockAI" },
      publisher: { "@type": "Organization", name: "StockAI" },
      datePublished,
      dateModified: datePublished,
      mainEntityOfPage: `${SITE}${path}`,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "AI Stock Trading", item: `${SITE}/ai-stock-trading` },
        { "@type": "ListItem", position: 3, name: title, item: `${SITE}${path}` },
      ],
    },
  ];

  if (faqs.length) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO title={metaTitle} description={metaDescription} path={path} type="article" jsonLd={jsonLd} />
      <Navbar />

      <main className="flex-1 container mx-auto px-4 sm:px-6 pt-20 md:pt-24 pb-16 max-w-3xl">
        <motion.article
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-10"
        >
          <header className="space-y-4">
            <div className="text-xs uppercase tracking-widest text-primary/80">{kicker}</div>
            <h1 className="text-4xl md:text-5xl font-light tracking-tight leading-tight">{title}</h1>
            <div className="text-lg text-muted-foreground leading-relaxed">{intro}</div>
          </header>

          {sections.map((s) => (
            <section key={s.id} id={s.id} className="space-y-4 scroll-mt-24">
              <h2 className="text-2xl font-medium tracking-tight">{s.heading}</h2>
              <div className="space-y-4 text-muted-foreground leading-relaxed">{s.body}</div>
            </section>
          ))}

          {faqs.length > 0 && (
            <section id="faq" className="space-y-5 scroll-mt-24">
              <h2 className="text-2xl font-medium tracking-tight">Frequently asked questions</h2>
              {faqs.map((f) => (
                <div key={f.q} className="space-y-1.5">
                  <h3 className="text-base font-medium">{f.q}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.a}</p>
                </div>
              ))}
            </section>
          )}

          {related.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-2xl font-medium tracking-tight">Related reading</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {related.map((r) => (
                  <Card key={r.href} className="glass-card p-4 hover:border-primary/30 transition-colors">
                    <Link to={r.href} className="block space-y-1">
                      <div className="text-sm font-medium">{r.title}</div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{r.body}</p>
                    </Link>
                  </Card>
                ))}
              </div>
            </section>
          )}

          <Card className="glass-card p-6 space-y-3">
            <div className="text-sm font-medium">See the engine on live data</div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Browse today's signal feed, check the public track record, or backtest your own
              parameters before risking capital.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link to="/dashboard">Open the dashboard <ArrowRight className="w-3.5 h-3.5 ml-1" /></Link>
              </Button>
              <Button asChild size="sm" variant="outline"><Link to="/performance">Track record</Link></Button>
              <Button asChild size="sm" variant="outline"><Link to="/ai-stock-trading">AI stock trading guide</Link></Button>
            </div>
          </Card>

          <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/50 pt-6">
            StockAI publishes research and paper-trading tools. Nothing here is financial advice, and
            past performance does not predict future results. See our{" "}
            <Link to="/disclosure" className="text-primary hover:underline">risk disclosure</Link>.
          </p>
        </motion.article>
      </main>

      <Footer />
    </div>
  );
};
