import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Heart, BarChart3, Shield, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

/**
 * Sticky mobile bottom navigation. Hidden on md and up.
 * Provides one-tap access to the primary pages of the app.
 *
 * All pages should add `pb-20 md:pb-0` (or similar) on their <main>
 * to make sure content isn't hidden behind this bar.
 */
export const MobileBottomNav = () => {
  const { pathname } = useLocation();
  const { user } = useAuth();

  // Hide on auth/onboarding/checkout flow
  const hiddenRoutes = ["/auth", "/onboarding", "/checkout/return"];
  if (hiddenRoutes.some((r) => pathname.startsWith(r))) return null;

  // For logged-out users, show a slimmer set
  const items = user
    ? [
        { href: "/dashboard", label: "Hub", icon: LayoutDashboard },
        { href: "/watchlist", label: "Watch", icon: Heart },
        { href: "/backtest", label: "Backtest", icon: BarChart3 },
        { href: "/settings", label: "Settings", icon: Shield },
      ]
    : [
        { href: "/", label: "Home", icon: Home },
        { href: "/pricing", label: "Pricing", icon: BarChart3 },
        { href: "/auth", label: "Sign in", icon: Shield },
      ];

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border/40 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <ul className="grid grid-cols-4 max-w-md mx-auto" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <li key={item.href}>
              <Link
                to={item.href}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[56px] text-[10px] font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground active:text-foreground",
                )}
                aria-current={isActive ? "page" : undefined}
              >
                {isActive && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-primary" />
                )}
                <Icon className={cn("w-5 h-5 transition-transform", isActive && "text-primary scale-110")} />
                <span className="tracking-tight">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
