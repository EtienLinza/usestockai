import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";
import { format } from "date-fns";

interface PriceChartProps {
  historicalData: { date: string; price: number }[];
  predictedPrice: number;
  uncertaintyLow: number;
  uncertaintyHigh: number;
  targetDate: string;
}

export const PriceChart = ({
  historicalData,
  predictedPrice,
  uncertaintyLow,
  uncertaintyHigh,
  targetDate,
}: PriceChartProps) => {
  const chartData = useMemo(() => {
    const data = historicalData.map((d) => ({
      date: d.date,
      price: d.price,
      predicted: null as number | null,
    }));

    // Add prediction point
    data.push({
      date: targetDate,
      price: null as any,
      predicted: predictedPrice,
    });

    return data;
  }, [historicalData, predictedPrice, targetDate]);

  const minPrice = Math.min(
    ...historicalData.map((d) => d.price),
    uncertaintyLow
  );
  const maxPrice = Math.max(
    ...historicalData.map((d) => d.price),
    uncertaintyHigh
  );
  const padding = (maxPrice - minPrice) * 0.1;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    const priceData = payload.find((p: any) => p.dataKey === "price");
    const predictedData = payload.find((p: any) => p.dataKey === "predicted");

    return (
      <div className="bg-card/95 backdrop-blur-sm border border-border/50 rounded-lg p-3 shadow-lg">
        <p className="text-xs text-muted-foreground mb-2">
          {(() => {
            try {
              return format(new Date(label), "MMM d, yyyy");
            } catch {
              return label;
            }
          })()}
        </p>
        {priceData?.value && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-sm font-mono">${priceData.value.toFixed(2)}</span>
          </div>
        )}
        {predictedData?.value && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-success" />
            <span className="text-sm font-mono">${predictedData.value.toFixed(2)}</span>
            <span className="text-xs text-muted-foreground">predicted</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(143 35% 45%)" stopOpacity={0.2} />
              <stop offset="95%" stopColor="hsl(143 35% 45%)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(0 0% 12%)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fill: "hsl(0 0% 50%)", fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "hsl(0 0% 12%)" }}
            tickFormatter={(value) => {
              try {
                return format(new Date(value), "M/d");
              } catch {
                return value;
              }
            }}
          />
          <YAxis
            domain={[minPrice - padding, maxPrice + padding]}
            tick={{ fill: "hsl(0 0% 50%)", fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "hsl(0 0% 12%)" }}
            tickFormatter={(value) => `$${value.toFixed(0)}`}
            width={50}
          />
          <Tooltip content={<CustomTooltip />} />
          
          {/* Historical price area */}
          <Area
            type="monotone"
            dataKey="price"
            stroke="hsl(143 35% 45%)"
            strokeWidth={1.5}
            fill="url(#colorPrice)"
            connectNulls={false}
            animationDuration={800}
          />
          
          {/* Prediction point */}
          <ReferenceDot
            x={targetDate}
            y={predictedPrice}
            r={6}
            fill="hsl(143 50% 50%)"
            stroke="hsl(143 50% 60%)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};