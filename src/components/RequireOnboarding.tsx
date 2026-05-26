import { ReactNode, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";

interface Props {
  children: ReactNode;
}

/**
 * Redirects authenticated users who haven't completed onboarding to /onboarding.
 * Public routes that don't require auth should NOT be wrapped in this.
 */
export const RequireOnboarding = ({ children }: Props) => {
  const { user, loading: authLoading } = useAuth();
  const { onboardingCompleted, loading: tierLoading } = useTier();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (authLoading || tierLoading) return;
    if (!user) return; // auth pages handle this
    if (!onboardingCompleted && location.pathname !== "/onboarding") {
      navigate("/onboarding", { replace: true });
    }
  }, [user, authLoading, tierLoading, onboardingCompleted, location.pathname, navigate]);

  return <>{children}</>;
};
