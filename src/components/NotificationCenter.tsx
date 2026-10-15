import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Bell, BellRing, CheckCircle2, ArrowUpRight, X, ShoppingCart, TrendingDown, Scissors,
  Ban, Eye, Activity, Settings2, BellDot, CheckCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type Category = "trades" | "alerts" | "watchlist" | "skipped" | "activity" | "system";

interface Notif {
  id: string;
  category: Category;
  kind: string;
  title: string;
  body: string | null;
  ticker: string | null;
  link: string | null;
  digest_count: number;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

const CATEGORIES: { key: "all" | Category; label: string }[] = [
  { key: "all", label: "All" },
  { key: "trades", label: "Trades" },
  { key: "alerts", label: "Alerts" },
  { key: "watchlist", label: "Watchlist" },
  { key: "skipped", label: "Skipped" },
  { key: "activity", label: "Activity" },
  { key: "system", label: "System" },
];

function iconFor(n: Notif) {
  if (n.kind === "buy") return { Icon: ShoppingCart, tone: "bg-success/10 text-success" };
  if (n.kind === "sell") return { Icon: TrendingDown, tone: "bg-warning/10 text-warning" };
  if (n.kind === "trim") return { Icon: Scissors, tone: "bg-warning/10 text-warning" };
  switch (n.category) {
    case "alerts": return { Icon: BellDot, tone: "bg-primary/10 text-primary" };
    case "watchlist": return { Icon: Eye, tone: "bg-primary/10 text-primary" };
    case "skipped": return { Icon: Ban, tone: "bg-muted text-muted-foreground" };
    case "system": return { Icon: Settings2, tone: "bg-muted text-muted-foreground" };
    default: return { Icon: Activity, tone: "bg-muted text-muted-foreground" };
  }
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.max(s, 0)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function NotificationCenter() {
  const { user } = useAuth();
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | Category>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("id, category, kind, title, body, ticker, link, digest_count, read_at, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(150);
    setItems((data ?? []) as Notif[]);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    load();
    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, load]);

  const unread = useMemo(() => items.filter((n) => !n.read_at), [items]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: unread.length };
    for (const n of unread) c[n.category] = (c[n.category] ?? 0) + 1;
    return c;
  }, [unread]);

  const visible = useMemo(
    () => items.filter((n) => (filter === "all" || n.category === filter) && (!unreadOnly || !n.read_at)),
    [items, filter, unreadOnly],
  );

  const groups = useMemo(() => {
    const out: { label: string; rows: Notif[] }[] = [];
    for (const n of visible) {
      const label = dayLabel(n.updated_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(n);
      else out.push({ label, rows: [n] });
    }
    return out;
  }, [visible]);

  const markRead = async (ids: string[]) => {
    if (!ids.length) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: now } : n)));
    await supabase.from("notifications").update({ read_at: now }).in("id", ids);
  };

  const dismiss = async (id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    await supabase.from("notifications").delete().eq("id", id);
  };

  if (!user) return null;
  const badge = unread.length;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="relative p-2" aria-label="Notifications">
          {badge > 0 ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
          {badge > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 px-0.5 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[380px] max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between p-3 border-b border-border/30">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Notifications</span>
            {badge > 0 && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{badge} new</Badge>}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setUnreadOnly((v) => !v)}
              className={cn("text-[11px] px-2 h-6 rounded-md", unreadOnly ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              Unread
            </button>
            {badge > 0 && (
              <Button variant="ghost" size="sm" className="text-[11px] h-6 px-2 text-muted-foreground"
                onClick={() => markRead(visible.filter((n) => !n.read_at).map((n) => n.id))}>
                <CheckCheck className="w-3 h-3 mr-1" /> Mark read
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 px-2 py-2 border-b border-border/20 overflow-x-auto">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={cn(
                "shrink-0 text-[11px] px-2 py-1 rounded-md transition-colors flex items-center gap-1",
                filter === c.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
              {(counts[c.key] ?? 0) > 0 && <span className="text-[10px] text-primary">{counts[c.key]}</span>}
            </button>
          ))}
        </div>

        <div className="max-h-[460px] overflow-y-auto">
          {groups.length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircle2 className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">You're all caught up</p>
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <div className="sticky top-0 z-10 bg-popover/95 backdrop-blur px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/10">
                  {g.label}
                </div>
                {g.rows.map((n) => {
                  const { Icon, tone } = iconFor(n);
                  const href = n.link ?? (n.ticker ? `/stock/${n.ticker}` : null);
                  return (
                    <div
                      key={n.id}
                      onMouseEnter={() => !n.read_at && markRead([n.id])}
                      className={cn(
                        "group flex items-start gap-3 px-3 py-2.5 border-b border-border/10 last:border-0 transition-colors hover:bg-muted/5",
                        !n.read_at && "bg-primary/[0.03]",
                      )}
                    >
                      <div className={cn("mt-0.5 shrink-0 w-7 h-7 rounded-md flex items-center justify-center", tone)}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2">
                          <p className="text-xs font-medium leading-snug flex-1">
                            {n.title}
                            {n.digest_count > 1 && <span className="ml-1 text-muted-foreground font-normal">×{n.digest_count}</span>}
                          </p>
                          <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(n.updated_at)}</span>
                          {!n.read_at && <span className="mt-1 w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-label="Unread" />}
                        </div>
                        {n.body && <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">{n.body}</p>}
                        {href && (
                          <Link to={href} onClick={() => setOpen(false)}
                            className="inline-flex items-center gap-1 mt-1 text-[10px] text-primary hover:underline">
                            {n.ticker ? `View ${n.ticker}` : "Open"} <ArrowUpRight className="w-2.5 h-2.5" />
                          </Link>
                        )}
                      </div>
                      <Button variant="ghost" size="sm"
                        className="h-6 w-6 p-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => dismiss(n.id)} aria-label="Dismiss notification">
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
