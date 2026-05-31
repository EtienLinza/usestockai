import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

export interface Candle {
  t: number; o: number; h: number; l: number; c: number; v: number;
}

interface StockChartProps {
  candles: Candle[];
  loading?: boolean;
  range: string;
}

export const StockChart = ({ candles, loading, range }: StockChartProps) => {
  const isIntraday = range === "1D" || range === "5D";

  const data = useMemo(
    () => candles.map(c => ({ t: c.t, price: c.c })),
    [candles],
  );

  const isUp = useMemo(() => {
    if (data.length < 2) return true;
    return data[data.length - 1].price >= data[0].price;
  }, [data]);

  const formatTick = (t: number) => {
    const d = new Date(t);
    if (isIntraday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (range === "5Y" || range === "1Y") return d.toLocaleDateString([], { month: "short", year: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  if (loading) {
    return <Skeleton className="w-full h-[360px]" />;
  }
  if (data.length === 0) {
    return (
      <div className="w-full h-[360px] flex items-center justify-center text-sm text-muted-foreground">
        No chart data available for this range
      </div>
    );
  }

  const stroke = isUp ? "hsl(var(--success))" : "hsl(var(--destructive))";
  const gradientId = `chart-grad-${isUp ? "up" : "down"}`;

  return (
    <div className="w-full h-[360px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.32} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={formatTick}
            stroke="hsl(var(--muted-foreground))"
            tick={{ fontSize: 11 }}
            minTickGap={40}
          />
          <YAxis
            domain={["auto", "auto"]}
            stroke="hsl(var(--muted-foreground))"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
            width={64}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
            formatter={(v: number) => [`$${v.toFixed(2)}`, "Price"]}
          />
          <Area
            type="monotone"
            dataKey="price"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
