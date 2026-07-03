import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/hooks/useAuth";
import { RequireOnboarding } from "./components/RequireOnboarding";
import { PaymentTestModeBanner } from "./components/PaymentTestModeBanner";
import { MobileBottomNav } from "./components/MobileBottomNav";
import { PageSkeleton } from "./components/PageSkeleton";

// Eager: landing is the LCP route, keep in the main bundle.
import Landing from "./pages/Landing";

// Lazy: every other route is code-split so first paint stays small.
const Auth = lazy(() => import("./pages/Auth"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Watchlist = lazy(() => import("./pages/Watchlist"));
const StockDetail = lazy(() => import("./pages/StockDetail"));
const Backtest = lazy(() => import("./pages/Backtest"));
const Settings = lazy(() => import("./pages/Settings"));
const SecurityActivity = lazy(() => import("./pages/SecurityActivity"));
const Security = lazy(() => import("./pages/Security"));
const AutotraderLog = lazy(() => import("./pages/AutotraderLog"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Disclosure = lazy(() => import("./pages/Disclosure"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const CheckoutReturn = lazy(() => import("./pages/CheckoutReturn"));
const TierWaitlist = lazy(() => import("./pages/TierWaitlist"));
const AiDividendStocks = lazy(() => import("./pages/guides/AiDividendStocks"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <PaymentTestModeBanner />
            <RequireOnboarding>
              <Suspense fallback={<PageSkeleton />}>
                <Routes>
                  <Route path="/" element={<Landing />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/pricing" element={<Pricing />} />
                  <Route path="/onboarding" element={<Onboarding />} />
                  <Route path="/checkout/return" element={<CheckoutReturn />} />
                  <Route path="/tier/:tier" element={<TierWaitlist />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/watchlist" element={<Watchlist />} />
                  <Route path="/stock/:ticker" element={<StockDetail />} />
                  <Route path="/backtest" element={<Backtest />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/settings/activity" element={<SecurityActivity />} />
                  <Route path="/security" element={<Security />} />
                  <Route path="/autotrader-log" element={<AutotraderLog />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/disclosure" element={<Disclosure />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
              <MobileBottomNav />
            </RequireOnboarding>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
