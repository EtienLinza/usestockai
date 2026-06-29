import { motion } from "framer-motion";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui/card";
import { ShieldCheck, Mail, Clock, ScrollText, AlertOctagon } from "lucide-react";

const SECURITY_EMAIL = "security@usestockai.lovable.app";

const Security = () => (
  <div className="min-h-screen bg-background flex flex-col">
    <SEO
      title="Security & Vulnerability Disclosure — StockAI"
      description="Report security vulnerabilities to StockAI. Scope, safe-harbor terms, response SLA, and contact for responsible disclosure."
      path="/security"
    />
    <Navbar />
    <main className="flex-1 container mx-auto px-4 sm:px-6 pt-20 md:pt-24 pb-12 max-w-3xl">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
        <header className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-medium tracking-tight">Security</h1>
          </div>
          <p className="text-muted-foreground">
            We take the security of StockAI and our users seriously. If you believe you've
            found a vulnerability, please report it responsibly using the contact below.
            This page is maintained by the StockAI team and describes our current practices —
            it is not a third-party certification.
          </p>
        </header>

        <Card className="glass-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" />
            <h2 className="font-medium">Report a vulnerability</h2>
          </div>
          <p className="text-sm">
            Email{" "}
            <a href={`mailto:${SECURITY_EMAIL}`} className="text-primary underline">
              {SECURITY_EMAIL}
            </a>
            {" "}with a clear description, reproduction steps, and any proof-of-concept.
            Please do not publicly disclose until we've had a chance to investigate and
            remediate.
          </p>
        </Card>

        <Card className="glass-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-primary" />
            <h2 className="font-medium">Scope</h2>
          </div>
          <div className="text-sm space-y-2 text-muted-foreground">
            <p><span className="text-foreground font-medium">In scope:</span> usestockai.lovable.app, *.lovable.app preview domains for this project, and our Supabase Edge Functions.</p>
            <p><span className="text-foreground font-medium">Out of scope:</span> third-party APIs we integrate with (Finnhub, Yahoo Finance, Stripe, Resend, Lovable Cloud platform itself), social-engineering of staff, physical attacks, and denial-of-service.</p>
          </div>
        </Card>

        <Card className="glass-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <h2 className="font-medium">Safe harbor</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            We won't pursue legal action against researchers acting in good faith who:
            avoid privacy violations, data destruction, and service disruption; only
            interact with accounts they own or have permission to test; give us a
            reasonable window to remediate before public disclosure; and don't exploit
            findings beyond what's needed to confirm them.
          </p>
        </Card>

        <Card className="glass-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            <h2 className="font-medium">Response SLA</h2>
          </div>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Acknowledgement of receipt within <span className="text-foreground">5 business days</span></li>
            <li>Initial triage and severity assessment within <span className="text-foreground">14 days</span></li>
            <li>Remediation timeline shared with the reporter</li>
            <li>Public credit (with your permission) once the fix ships</li>
          </ul>
        </Card>

        <Card className="glass-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-amber-500" />
            <h2 className="font-medium">What StockAI is and isn't</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            StockAI is a paper-trading research platform. No real funds, brokerage
            credentials, or PII beyond email addresses are stored. We have not yet
            commissioned a formal third-party penetration test, and we make no
            certification-style claims (SOC 2, ISO, PCI). Anything you find that
            contradicts this page is a finding we want to hear about.
          </p>
        </Card>
      </motion.div>
    </main>
    <Footer />
  </div>
);

export default Security;
