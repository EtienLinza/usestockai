import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/hooks/useAuth";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Watchlist from "./pages/Watchlist";
import StockDetail from "./pages/StockDetail";

import Backtest from "./pages/Backtest";
import Settings from "./pages/Settings";
import AutotraderLog from "./pages/AutotraderLog";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Disclosure from "./pages/Disclosure";
import Pricing from "./pages/Pricing";
import Onboarding from "./pages/Onboarding";
import CheckoutReturn from "./pages/CheckoutReturn";
import NotFound from "./pages/NotFound";
import { RequireOnboarding } from "./components/RequireOnboarding";
import { PaymentTestModeBanner } from "./components/PaymentTestModeBanner";
import { MobileBottomNav } from "./components/MobileBottomNav";

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
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/checkout/return" element={<CheckoutReturn />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/watchlist" element={<Watchlist />} />
                <Route path="/stock/:ticker" element={<StockDetail />} />
                <Route path="/backtest" element={<Backtest />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/autotrader-log" element={<AutotraderLog />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/disclosure" element={<Disclosure />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
              <MobileBottomNav />
            </RequireOnboarding>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;