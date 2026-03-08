import { useState, useEffect } from "react";
import { Bell, BellRing, AlertTriangle, TrendingDown, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  type: "price_alert" | "sell_alert";
  ticker: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export function NotificationCenter() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;

    const loadNotifications = async () => {
      const [{ data: priceAlerts }, { data: sellAlerts }] = await Promise.all([
        supabase
          .from("price_alerts")
          .select("*")
          .eq("user_id", user.id)
          .eq("is_triggered", true)
          .order("triggered_at", { ascending: false })
          .limit(10),
        supabase
          .from("sell_alerts")
          .select("*")
          .eq("user_id", user.id)
          .eq("is_dismissed", false)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

      const items: Notification[] = [];

      if (priceAlerts) {
        priceAlerts.forEach((a: any) => {
          items.push({
            id: `pa-${a.id}`,
            type: "price_alert",
            ticker: a.ticker,
            message: `${a.ticker} hit $${Number(a.target_price).toFixed(2)} (${a.direction})`,
            timestamp: a.triggered_at || a.created_at,
            read: false,
          });
        });
      }

      if (sellAlerts) {
        sellAlerts.forEach((a: any) => {
          items.push({
            id: `sa-${a.id}`,
            type: "sell_alert",
            ticker: a.ticker,
            message: `${a.ticker}: ${a.reason}`,
            timestamp: a.created_at,
            read: false,
          });
        });
      }

      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setNotifications(items);
    };

    loadNotifications();

    const channel = supabase
      .channel("notifications-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "price_alerts", filter: `user_id=eq.${user.id}` }, () => loadNotifications())
      .on("postgres_changes", { event: "*", schema: "public", table: "sell_alerts", filter: `user_id=eq.${user.id}` }, () => loadNotifications())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const unreadCount = notifications.length;

  const dismissNotification = async (n: Notification) => {
    if (n.type === "sell_alert") {
      const realId = n.id.replace("sa-", "");
      await supabase.from("sell_alerts").update({ is_dismissed: true }).eq("id", realId);
    }
    setNotifications(prev => prev.filter(item => item.id !== n.id));
  };

  const clearAll = async () => {
    for (const n of notifications) {
      if (n.type === "sell_alert") {
        const realId = n.id.replace("sa-", "");
        await supabase.from("sell_alerts").update({ is_dismissed: true }).eq("id", realId);
      }
    }
    setNotifications([]);
  };

  if (!user) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="relative p-2">
          {unreadCount > 0 ? (
            <BellRing className="w-4 h-4" />
          ) : (
            <Bell className="w-4 h-4" />
          )}
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between p-3 border-b border-border/30">
          <span className="text-sm font-medium">Notifications</span>
          {notifications.length > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-6 px-2 text-muted-foreground" onClick={clearAll}>
              Clear all
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-6 text-center">
              <CheckCircle2 className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No notifications</p>
            </div>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className="flex items-start gap-3 p-3 hover:bg-muted/5 transition-colors border-b border-border/10 last:border-0">
                <div className={cn("mt-0.5 shrink-0", n.type === "sell_alert" ? "text-warning" : "text-primary")}>
                  {n.type === "sell_alert" ? <AlertTriangle className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs leading-relaxed">{n.message}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(n.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => dismissNotification(n)}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
