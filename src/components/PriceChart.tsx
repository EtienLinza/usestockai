import { useMemo, useState, useCallback } from "react";
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
  Brush,
} from "recharts";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

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
  const [zoomLevel, setZoomLevel] = useState(1);
  const [brushStartIndex, setBrushStartIndex] = useState<number | undefined>(undefined);
  const [brushEndIndex, setBrushEndIndex] = useState<number | undefined>(undefined);

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

  const handleZoomIn = useCallback(() => {
    setZoomLevel(prev => Math.min(prev + 0.5, 3));
    const dataLength = chartData.length;
    const visiblePoints = Math.max(5, Math.floor(dataLength / (zoomLevel + 0.5)));
    setBrushStartIndex(Math.max(0, dataLength - visiblePoints - 1));
    setBrushEndIndex(dataLength - 1);
  }, [chartData.length, zoomLevel]);

  const handleZoomOut = useCallback(() => {
    setZoomLevel(prev => Math.max(prev - 0.5, 1));
    if (zoomLevel <= 1.5) {
      setBrushStartIndex(undefined);
      setBrushEndIndex(undefined);
    }
  }, [zoomLevel]);

  const handleReset = useCallback(() => {
    setZoomLevel(1);
    setBrushStartIndex(undefined);
    setBrushEndIndex(undefined);
  }, []);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    const priceData = payload.find((p: any) => p.dataKey === "price");
    const predictedData = payload.find((p: any) => p.dataKey === "predicted");
    const lowData = payload.find((p: any) => p.dataKey === "uncertaintyLow");
    const highData = payload.find((p: any) => p.dataKey === "uncertaintyHigh");

    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
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
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-full bg-primary" />
            <span className="text-sm">Historical: <span className="font-mono font-semibold">${priceData.value.toFixed(2)}</span></span>
          </div>
        )}
        {predictedData?.value && (
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-full bg-success" />
            <span className="text-sm">Predicted: <span className="font-mono font-semibold">${predictedData.value.toFixed(2)}</span></span>
          </div>
        )}
        {lowData?.value && highData?.value && (
          <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
            Range: ${lowData.value.toFixed(2)} - ${highData.value.toFixed(2)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Chart Controls */}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleZoomIn}
          disabled={zoomLevel >= 3}
          className="h-8 w-8 p-0"
        >
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleZoomOut}
          disabled={zoomLevel <= 1}
          className="h-8 w-8 p-0"
        >
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          className="h-8 w-8 p-0"
        >
          <RotateCcw className="w-4 h-4" />
        </Button>
      </div>

      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(143 35% 45%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(143 35% 45%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorPredicted" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(143 45% 55%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(143 45% 55%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(0 0% 16%)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fill: "hsl(0 0% 55%)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "hsl(0 0% 16%)" }}
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
              tick={{ fill: "hsl(0 0% 55%)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "hsl(0 0% 16%)" }}
              tickFormatter={(value) => `$${value.toFixed(0)}`}
            />
            <Tooltip content={<CustomTooltip />} />
            
            {/* Brush for zooming/panning */}
            <Brush
              dataKey="date"
              height={30}
              stroke="hsl(143 35% 45%)"
              fill="hsl(0 0% 8%)"
              startIndex={brushStartIndex}
              endIndex={brushEndIndex}
              onChange={(e: any) => {
                setBrushStartIndex(e.startIndex);
                setBrushEndIndex(e.endIndex);
              }}
              tickFormatter={(value) => {
                try {
                  return format(new Date(value), "M/d");
                } catch {
                  return "";
                }
              }}
            />
            
            {/* Historical price area */}
            <Area
              type="monotone"
              dataKey="price"
              stroke="hsl(143 35% 45%)"
              strokeWidth={2}
              fill="url(#colorPrice)"
              connectNulls={false}
              animationDuration={1000}
            />
            
            {/* Uncertainty range (shown as area between low and high) */}
            <Area
              type="monotone"
              dataKey="uncertaintyHigh"
              stroke="transparent"
              fill="hsl(143 45% 50% / 0.1)"
              connectNulls={false}
            />
            
            {/* Prediction point reference */}
            {chartData.length > 0 && (
              <ReferenceDot
                x={targetDate}
                y={predictedPrice}
                r={8}
                fill="hsl(143 45% 50%)"
                stroke="hsl(143 50% 60%)"
                strokeWidth={2}
              />
            )}
            
            {/* Reference line from last historical to prediction */}
            <ReferenceLine
              segment={[
                { x: historicalData[historicalData.length - 1]?.date, y: historicalData[historicalData.length - 1]?.price },
                { x: targetDate, y: predictedPrice }
              ]}
              stroke="hsl(143 45% 50%)"
              strokeDasharray="5 5"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};