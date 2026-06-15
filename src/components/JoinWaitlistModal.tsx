import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Tier } from "@/lib/tier-features";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tier: Tier;
  billingCycle?: "monthly" | "annual";
}

/**
 * Legacy modal kept for backwards compatibility. Payments are paused, so
 * any caller that opens this is redirected to the tier waitlist page where
 * we collect the email and route them through onboarding.
 */
export const JoinWaitlistModal = ({ open, onOpenChange, tier }: Props) => {
  const navigate = useNavigate();
  useEffect(() => {
    if (open) {
      onOpenChange(false);
      navigate(`/tier/${tier}`);
    }
  }, [open, tier, onOpenChange, navigate]);
  return null;
};
