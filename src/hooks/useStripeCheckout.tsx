import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

interface CheckoutOptions {
  priceId: string;
  customerEmail?: string;
  userId?: string;
  returnUrl?: string;
}

/**
 * Payments are paused. This hook used to open a Stripe Embedded Checkout;
 * it now redirects any caller to the tier waitlist landing page so we
 * never invoke the live payment provider. Kept as a shim so existing
 * callers compile without changes.
 */
export function useStripeCheckout() {
  const navigate = useNavigate();

  const openCheckout = useCallback(
    (opts: CheckoutOptions) => {
      const tier = opts.priceId?.startsWith("elite") ? "elite" : "pro";
      navigate(`/tier/${tier}`);
    },
    [navigate],
  );

  const closeCheckout = useCallback(() => {}, []);

  return {
    openCheckout,
    closeCheckout,
    isOpen: false as const,
    checkoutElement: null,
  };
}
