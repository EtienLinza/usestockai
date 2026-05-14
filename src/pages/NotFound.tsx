import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";
import { SEO } from "@/components/SEO";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative">
      <SEO title="Page not found | StockAI" description="The page you're looking for doesn't exist." path={location.pathname} noindex />
      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/2 rounded-full blur-[150px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center relative z-10 px-4"
      >
        <div className="flex justify-center mb-6">
          <Logo />
        </div>
        <h1 className="text-6xl sm:text-8xl font-bold text-primary mb-4">404</h1>
        <p className="text-lg text-muted-foreground mb-8">
          This page doesn't exist
        </p>
        <Button onClick={() => navigate("/dashboard")} className="gap-2">
          <Home className="w-4 h-4" />
          Return to Dashboard
        </Button>
      </motion.div>
    </div>
  );
};

export default NotFound;
