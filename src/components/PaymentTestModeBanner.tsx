import { Link } from "react-router-dom";

/**
 * Payments are intentionally paused while we finish billing setup.
 * Even though a Stripe test token is still configured in the env,
 * checkout is disabled across the app. This banner makes that clear
 * and routes interested users to the waitlist.
 */
export function PaymentTestModeBanner() {
  return (
    <div className="w-full bg-amber-100 border-b border-amber-300 px-4 py-2 text-center text-sm text-amber-900">
      Payments are paused while we finalize billing.{" "}
      <Link to="/tier/pro" className="underline font-medium">
        Join the waitlist
      </Link>{" "}
      for early access.
    </div>
  );
}
