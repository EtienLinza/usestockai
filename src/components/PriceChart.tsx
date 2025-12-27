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
  ReferenceLine,
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
      uncertaintyLow: null as number | null,
      uncertaintyHigh: null as number | null,
    }));

    // Add prediction point
    data.push({
      date: targetDate,
      price: null as any,
      predicted: predictedPrice,
      uncertaintyLow,
      uncertaintyHigh,
    });

    return data;
  }, [historicalData, predictedPrice, uncertaintyLow, uncertaintyHigh, targetDate]);

  const minPrice = Math.min(
    ...historicalData.map((d) => d.price),
    uncertaintyLow
  );
  const maxPrice = Math.max(
    ...historicalData.map((d) => d.price),
    uncertaintyHigh
  );
  const padding = (maxPrice - minPrice) * 0.1;

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(187 100% 42%)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(187 100% 42%)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorPredicted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(145 65% 42%)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(145 65% 42%)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(220 20% 18%)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fill: "hsl(215 15% 55%)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "hsl(220 20% 18%)" }}
            tickFormatter={(value) => {
              try {
                return format(new Date(value), "MMM d");
              } catch {
                return value;
              }
            }}
          />
          <YAxis
            domain={[minPrice - padding, maxPrice + padding]}
            tick={{ fill: "hsl(215 15% 55%)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "hsl(220 20% 18%)" }}
            tickFormatter={(value) => `$${value.toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(228 18% 10%)",
              border: "1px solid hsl(220 20% 18%)",
              borderRadius: "8px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            }}
            labelStyle={{ color: "hsl(210 40% 96%)" }}
            itemStyle={{ color: "hsl(187 100% 42%)" }}
            formatter={(value: number, name: string) => {
              const labels: Record<string, string> = {
                price: "Historical Price",
                predicted: "Predicted Price",
                uncertaintyLow: "Lower Bound",
                uncertaintyHigh: "Upper Bound",
              };
              return [`$${value?.toFixed(2) || "N/A"}`, labels[name] || name];
            }}
          />
          
          {/* Historical price area */}
          <Area
            type="monotone"
            dataKey="price"
            stroke="hsl(187 100% 42%)"
            strokeWidth={2}
            fill="url(#colorPrice)"
            connectNulls={false}
          />
          
          {/* Uncertainty range (shown as area between low and high) */}
          <Area
            type="monotone"
            dataKey="uncertaintyHigh"
            stroke="transparent"
            fill="hsl(145 65% 42% / 0.1)"
            connectNulls={false}
          />
          
          {/* Prediction point reference */}
          {chartData.length > 0 && (
            <ReferenceDot
              x={targetDate}
              y={predictedPrice}
              r={8}
              fill="hsl(145 65% 42%)"
              stroke="hsl(145 65% 50%)"
              strokeWidth={2}
            />
          )}
          
          {/* Reference line from last historical to prediction */}
          <ReferenceLine
            segment={[
              { x: historicalData[historicalData.length - 1]?.date, y: historicalData[historicalData.length - 1]?.price },
              { x: targetDate, y: predictedPrice }
            ]}
            stroke="hsl(145 65% 42%)"
            strokeDasharray="5 5"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
