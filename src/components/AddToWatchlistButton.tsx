import { useState, useEffect } from "react";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface AddToWatchlistButtonProps {
  ticker: string;
  assetType?: "stock" | "crypto";
  className?: string;
  size?: "sm" | "default" | "lg" | "icon";
}

export const AddToWatchlistButton = ({ 
  ticker, 
  assetType = "stock",
  className,
  size = "icon"
}: AddToWatchlistButtonProps) => {
  const { user } = useAuth();
  const [isInWatchlist, setIsInWatchlist] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (user) {
      checkWatchlist();
    }
  }, [user, ticker]);

  const checkWatchlist = async () => {
    if (!user) return;
    
    const { data } = await supabase
      .from("watchlist")
      .select("id")
      .eq("user_id", user.id)
      .eq("ticker", ticker.toUpperCase())
      .maybeSingle();
    
    setIsInWatchlist(!!data);
  };

  const toggleWatchlist = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent parent click handlers
    
    if (!user) {
      toast.error("Please sign in to use watchlist");
      return;
    }

    setIsLoading(true);
    
    try {
      if (isInWatchlist) {
        // Remove from watchlist
        const { error } = await supabase
          .from("watchlist")
          .delete()
          .eq("user_id", user.id)
          .eq("ticker", ticker.toUpperCase());
        
        if (error) throw error;
        
        setIsInWatchlist(false);
        toast.success(`${ticker} removed from watchlist`);
      } else {
        // Add to watchlist
        const { error } = await supabase
          .from("watchlist")
          .insert({
            user_id: user.id,
            ticker: ticker.toUpperCase(),
            asset_type: assetType,
          });
        
        if (error) throw error;
        
        setIsInWatchlist(true);
        toast.success(`${ticker} added to watchlist`);
      }
    } catch (error) {
      console.error("Watchlist error:", error);
      toast.error("Failed to update watchlist");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size={size}
      onClick={toggleWatchlist}
      disabled={isLoading || !user}
      className={cn(
        "transition-all",
        isInWatchlist && "text-destructive hover:text-destructive/80",
        className
      )}
      title={isInWatchlist ? "Remove from watchlist" : "Add to watchlist"}
    >
      <Heart 
        className={cn(
          "w-4 h-4 transition-all",
          isInWatchlist && "fill-current"
        )} 
      />
    </Button>
  );
};
