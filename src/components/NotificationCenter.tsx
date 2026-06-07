import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Bell, BellRing, AlertTriangle, TrendingUp, TrendingDown, X, CheckCircle2, ArrowUpRight } from "lucide-react";
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

type NotifType = "price_alert" | "sell_alert";

interface Notification {
  id: string;
  rawId: string;
  type: NotifType;
  ticker: string;
  title: string;
  detail: string;
  price?: number;
  direction?: "above" | "below";
  reason?: string;
  timestamp: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function NotificationCenter() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | NotifType>("all");

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
          .limit(20),
        supabase
          .from("sell_alerts")
          .select("*")
          .eq("user_id", user.id)
          .eq("is_dismissed", false)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      const items: Notification[] = [];

      priceAlerts?.forEach((a: any) => {
        items.push({
          id: `pa-${a.id}`,
          rawId: a.id,
          type: "price_alert",
          ticker: a.ticker,
          title: `${a.ticker} crossed ${a.direction} $${Number(a.target_price).toFixed(2)}`,
          detail: `Target ${a.direction} $${Number(a.target_price).toFixed(2)}`,
          price: Number(a.target_price),
          direction: a.direction,
          timestamp: a.triggered_at || a.created_at,
        });
      });

      sellAlerts?.forEach((a: any) => {
        items.push({
          id: `sa-${a.id}`,
          rawId: a.id,
          type: "sell_alert",
          ticker: a.ticker,
          title: `Exit signal: ${a.ticker}`,
          detail: a.reason,
          price: Number(a.current_price),
          reason: a.reason,
          timestamp: a.created_at,
        });
      });

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

  const filtered = useMemo(
    () => (filter === "all" ? notifications : notifications.filter((n) => n.type === filter)),
    [filter, notifications]
  );

  const counts = useMemo(() => ({
    all: notifications.length,
    price_alert: notifications.filter((n) => n.type === "price_alert").length,
    sell_alert: notifications.filter((n) => n.type === "sell_alert").length,
  }), [notifications]);

  const dismissNotification = async (n: Notification) => {
    if (n.type === "sell_alert") {
      await supabase.from("sell_alerts").update({ is_dismissed: true }).eq("id", n.rawId);
    } else {
      await supabase.from("price_alerts").update({ is_triggered: false, triggered_at: null }).eq("id", n.rawId);
    }
    setNotifications((prev) => prev.filter((x) => x.id !== n.id));
  };

  const clearAll = async () => {
    const sellIds = notifications.filter((n) => n.type === "sell_alert").map((n) => n.rawId);
    const priceIds = notifications.filter((n) => n.type === "price_alert").map((n) => n.rawId);
    if (sellIds.length) await supabase.from("sell_alerts").update({ is_dismissed: true }).in("id", sellIds);
    if (priceIds.length) await supabase.from("price_alerts").update({ is_triggered: false, triggered_at: null }).in("id", priceIds);
    setNotifications([]);
  };

  if (!user) return null;

  const unreadCount = notifications.length;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="relative p-2" aria-label="Notifications">
          {unreadCount > 0 ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[360px] p-0">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-border/30">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{unreadCount}</Badge>
            )}
          </div>
          {notifications.length > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-6 px-2 text-muted-foreground" onClick={clearAll}>
              Clear all
            </Button>
          )}
        </div>

        {/* Filter tabs */}
        {notifications.length > 0 && (
          <div className="flex items-center gap-1 px-3 py-2 border-b border-border/20">
            {(["all", "sell_alert", "price_alert"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "text-[11px] px-2 py-1 rounded-md transition-colors flex items-center gap-1.5",
                  filter === f ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f === "all" ? "All" : f === "sell_alert" ? "Exit signals" : "Price alerts"}
                <span className="text-[10px] opacity-60">{counts[f]}</span>
              </button>
            ))}
          </div>
        )}

        {/* List */}
        <div className="max-h-[420px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircle2 className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">You're all caught up</p>
            </div>
          ) : (
            filtered.map((n) => {
              const isSell = n.type === "sell_alert";
              const isAbove = n.direction === "above";
              return (
                <div
                  key={n.id}
                  className="group flex items-start gap-3 p-3 hover:bg-muted/5 transition-colors border-b border-border/10 last:border-0"
                >
                  <div
                    className={cn(
                      "mt-0.5 shrink-0 w-8 h-8 rounded-md flex items-center justify-center",
                      isSell ? "bg-warning/10 text-warning" : isAbove ? "bg-success/10 text-success" : "bg-primary/10 text-primary"
                    )}
                  >
                    {isSell ? <AlertTriangle className="w-4 h-4" /> : isAbove ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Tags */}
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-4 px-1.5 text-[9px] font-semibold uppercase tracking-wide",
                          isSell ? "border-warning/40 text-warning" : "border-primary/40 text-primary"
                        )}
                      >
                        {isSell ? "Exit" : "Price"}
                      </Badge>
                      <Link
                        to={`/stock/${n.ticker}`}
                        onClick={() => setOpen(false)}
                        className="text-[10px] font-semibold tracking-wide hover:text-primary transition-colors"
                      >
                        ${n.ticker}
                      </Link>
                      {!isSell && n.direction && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "h-4 px-1.5 text-[9px] uppercase",
                            isAbove ? "border-success/40 text-success" : "border-destructive/40 text-destructive"
                          )}
                        >
                          {n.direction}
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto">{timeAgo(n.timestamp)}</span>
                    </div>

                    {/* Title */}
                    <p className="text-xs font-medium leading-snug">{n.title}</p>

                    {/* Detail */}
                    {isSell && n.detail && (
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed line-clamp-2">{n.detail}</p>
                    )}
                    {n.price !== undefined && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {isSell ? "Current" : "Target"}: <span className="text-foreground font-medium">${n.price.toFixed(2)}</span>
                      </p>
                    )}

                    {/* Action */}
                    <Link
                      to={`/stock/${n.ticker}`}
                      onClick={() => setOpen(false)}
                      className="inline-flex items-center gap-1 mt-1.5 text-[10px] text-primary hover:underline"
                    >
                      View {n.ticker} <ArrowUpRight className="w-2.5 h-2.5" />
                    </Link>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => dismissNotification(n)}
                    aria-label="Dismiss notification"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
