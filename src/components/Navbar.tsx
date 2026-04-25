import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationCenter } from "@/components/NotificationCenter";
import { useAuth } from "@/hooks/useAuth";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { User, LogOut, LayoutDashboard, Heart, Menu, BarChart3, Brain, Shield, Bot } from "lucide-react";

export const Navbar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Primary nav (always visible on desktop)
  const navLinks = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/watchlist", label: "Watchlist", icon: Heart },
    { href: "/backtest", label: "Backtest", icon: BarChart3 },
    { href: "/settings", label: "Settings", icon: Shield },
  ];

  // Secondary nav (in user dropdown on desktop, full list in mobile sheet)
  const secondaryLinks = [
    { href: "/calibration", label: "Calibration", icon: Brain },
    { href: "/autotrader-log", label: "AutoTrader Log", icon: Bot },
  ];

  const allLinks = [...navLinks, ...secondaryLinks];

  const handleSignOut = async () => {
    await signOut();
    setMobileMenuOpen(false);
    navigate("/");
  };

  const handleNavigation = (href: string) => {
    setMobileMenuOpen(false);
    navigate(href);
  };

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed top-0 left-0 right-0 z-50 border-b border-border/30 bg-background/90 backdrop-blur-md"
    >
      <div className="container mx-auto px-6">
        <div className="flex h-14 items-center justify-between">
          <Link to="/" className="flex items-center">
            <Logo size="sm" />
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const isActive = location.pathname === link.href;
              const Icon = link.icon;
              return (
                <Link key={link.href} to={link.href}>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    size="sm"
                    className={`gap-2 ${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <Icon className="w-4 h-4" />
                    {link.label}
                  </Button>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            {/* Notification Center */}
            <NotificationCenter />

            {/* Theme Toggle */}
            <ThemeToggle />

            {/* Mobile Menu */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild className="md:hidden">
                <Button variant="ghost" size="sm" className="p-2">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[280px] sm:w-[320px]">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <Logo size="sm" showText={false} />
                    <span>StockAI</span>
                  </SheetTitle>
                </SheetHeader>
                <nav className="flex flex-col gap-2 mt-6">
                  {allLinks.map((link) => {
                    const isActive = location.pathname === link.href;
                    const Icon = link.icon;
                    return (
                      <Button
                        key={link.href}
                        variant={isActive ? "secondary" : "ghost"}
                        className={`justify-start gap-3 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                        onClick={() => handleNavigation(link.href)}
                      >
                        <Icon className="w-4 h-4" />
                        {link.label}
                      </Button>
                    );
                  })}
                  
                  <div className="border-t border-border/30 my-4" />
                  
                  {user ? (
                    <>
                      <div className="px-3 py-2 text-sm text-muted-foreground truncate">
                        {user.email}
                      </div>
                      <Button
                        variant="ghost"
                        className="justify-start gap-3 text-destructive hover:text-destructive"
                        onClick={handleSignOut}
                      >
                        <LogOut className="w-4 h-4" />
                        Sign Out
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        className="justify-start"
                        onClick={() => handleNavigation("/auth")}
                      >
                        Sign In
                      </Button>
                      <Button
                        variant="default"
                        className="justify-start"
                        onClick={() => handleNavigation("/auth?mode=signup")}
                      >
                        Get Started
                      </Button>
                    </>
                  )}
                </nav>
              </SheetContent>
            </Sheet>

            {/* Desktop Auth */}
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:bg-accent hover:text-accent-foreground h-9 px-3 hidden sm:flex">
                    <User className="w-4 h-4" />
                    <span className="max-w-[100px] truncate text-muted-foreground">
                      {user.email}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => navigate("/dashboard")}>
                    <LayoutDashboard className="w-4 h-4 mr-2" />
                    Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/watchlist")}>
                    <Heart className="w-4 h-4 mr-2" />
                    Watchlist
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="hidden md:flex items-center gap-3">
                <Link to="/auth">
                  <Button variant="ghost" size="sm" className="text-muted-foreground">
                    Sign In
                  </Button>
                </Link>
                <Link to="/auth?mode=signup">
                  <Button variant="default" size="sm">
                    Get Started
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.header>
  );
};
