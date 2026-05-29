import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Loader2 } from "lucide-react";
import { useTier } from "@/hooks/useTier";
import { SEO } from "@/components/SEO";

export default function CheckoutReturn() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const navigate = useNavigate();
  const { invalidate, tier } = useTier();

  // Webhook will update the tier; poll-refresh by invalidating the cache a few times.
  useEffect(() => {
    if (!sessionId) return;
    const timers = [500, 1500, 3000, 6000].map((ms) => setTimeout(() => invalidate(), ms));
    return () => timers.forEach(clearTimeout);
  }, [sessionId, invalidate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <SEO title="Payment confirmed — StockAI" description="Your subscription is active." path="/checkout/return" />
      <Card className="p-10 max-w-md w-full text-center">
        {sessionId ? (
          <>
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Check className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-2xl font-light mb-2">Payment confirmed</h1>
            <p className="text-sm text-muted-foreground mb-2">
              Welcome aboard. Your subscription is being activated.
            </p>
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mb-6">
              {tier === "free" ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" /> Unlocking your plan…
                </>
              ) : (
                <>Plan: <span className="text-foreground capitalize ml-1">{tier}</span></>
              )}
            </p>
            <Button className="w-full" onClick={() => navigate("/dashboard")}>
              Go to dashboard
            </Button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-light mb-2">No session found</h1>
            <p className="text-sm text-muted-foreground mb-6">
              We couldn't find your checkout session. Try again from the pricing page.
            </p>
            <Button className="w-full" onClick={() => navigate("/pricing")}>
              View pricing
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
