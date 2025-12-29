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
  ReferenceArea,
  Line,
  ComposedChart,
} from "recharts";
import { format, parseISO, differenceInDays } from "date-fns";

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
      predictedLine: null as number | null,
      uncertaintyLow: null as number | null,
      uncertaintyHigh: null as number | null,
    }));

    // Get last historical price for connection
    const lastHistorical = historicalData[historicalData.length - 1];
    
    if (lastHistorical) {
      // Update last data point to start prediction line
      data[data.length - 1] = {
        ...data[data.length - 1],
        predictedLine: lastHistorical.price,
      };
    }

    // Add prediction point
    data.push({
      date: targetDate,
      price: null as any,
      predicted: predictedPrice,
      predictedLine: predictedPrice,
      uncertaintyLow: uncertaintyLow,
      uncertaintyHigh: uncertaintyHigh,
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
  const padding = (maxPrice - minPrice) * 0.15;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    const priceData = payload.find((p: any) => p.dataKey === "price");
    const predictedData = payload.find((p: any) => p.dataKey === "predicted");
    const lowData = payload.find((p: any) => p.dataKey === "uncertaintyLow");
    const highData = payload.find((p: any) => p.dataKey === "uncertaintyHigh");

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
            <span className="text-xs text-muted-foreground">actual</span>
          </div>
        )}
        {predictedData?.value && (
          <>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-chart-2" />
              <span className="text-sm font-mono">${predictedData.value.toFixed(2)}</span>
              <span className="text-xs text-muted-foreground">predicted</span>
            </div>
            {lowData?.value && highData?.value && (
              <div className="flex items-center gap-2 mt-1">
                <div className="w-2 h-2 rounded-full bg-chart-2/30" />
                <span className="text-xs font-mono text-muted-foreground">
                  ${lowData.value.toFixed(2)} - ${highData.value.toFixed(2)}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex items-center gap-6 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 bg-primary rounded" />
          <span className="text-muted-foreground">Historical</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 bg-chart-2 rounded" style={{ borderStyle: 'dashed' }} />
          <span className="text-muted-foreground">Predicted</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-chart-2/20 rounded" />
          <span className="text-muted-foreground">Uncertainty Range</span>
        </div>
      </div>

      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(143 35% 45%)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="hsl(143 35% 45%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorPredicted" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(200 70% 50%)" stopOpacity={0.15} />
                <stop offset="95%" stopColor="hsl(200 70% 50%)" stopOpacity={0} />
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
            
            {/* Uncertainty range area */}
            <Area
              type="monotone"
              dataKey="uncertaintyHigh"
              stroke="transparent"
              fill="hsl(200 70% 50%)"
              fillOpacity={0.1}
              connectNulls={false}
            />
            <Area
              type="monotone"
              dataKey="uncertaintyLow"
              stroke="transparent"
              fill="hsl(0 0% 5%)"
              fillOpacity={1}
              connectNulls={false}
            />
            
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
            
            {/* Prediction line */}
            <Line
              type="monotone"
              dataKey="predictedLine"
              stroke="hsl(200 70% 50%)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              connectNulls={true}
              animationDuration={800}
            />
            
            {/* Prediction point with glow effect */}
            <ReferenceDot
              x={targetDate}
              y={predictedPrice}
              r={8}
              fill="hsl(200 70% 50%)"
              stroke="hsl(200 70% 60%)"
              strokeWidth={3}
              style={{ filter: "drop-shadow(0 0 8px hsl(200 70% 50% / 0.5))" }}
            />
            
            {/* Uncertainty bounds markers */}
            <ReferenceDot
              x={targetDate}
              y={uncertaintyHigh}
              r={3}
              fill="hsl(200 70% 50%)"
              fillOpacity={0.5}
              stroke="transparent"
            />
            <ReferenceDot
              x={targetDate}
              y={uncertaintyLow}
              r={3}
              fill="hsl(200 70% 50%)"
              fillOpacity={0.5}
              stroke="transparent"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};