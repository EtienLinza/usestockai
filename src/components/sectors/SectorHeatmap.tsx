import { motion } from "framer-motion";

interface SectorData {
  sector: string;
  etfTicker: string;
  dailyChange: number;
}

interface SectorHeatmapProps {
  sectors: SectorData[];
}

export function SectorHeatmap({ sectors }: SectorHeatmapProps) {
  const sortedSectors = [...sectors].sort((a, b) => b.dailyChange - a.dailyChange);
  const maxChange = Math.max(...sectors.map(s => Math.abs(s.dailyChange)), 0.01);

  const getColor = (change: number) => {
    const intensity = Math.min(Math.abs(change) / maxChange, 1);
    if (change > 0) {
      return `hsl(143 50% ${50 - intensity * 20}% / ${0.3 + intensity * 0.5})`;
    }
    return `hsl(0 70% ${50 - intensity * 15}% / ${0.3 + intensity * 0.5})`;
  };

  return (
    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
      {sortedSectors.map((sector, index) => (
        <motion.div
          key={sector.etfTicker}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: index * 0.05 }}
          className="relative aspect-square rounded-lg overflow-hidden border border-border/30 flex flex-col items-center justify-center p-2 text-center"
          style={{ backgroundColor: getColor(sector.dailyChange) }}
        >
          <span className="text-xs font-medium truncate w-full">{sector.sector}</span>
          <span className={`font-mono text-sm font-bold ${
            sector.dailyChange >= 0 ? "text-success" : "text-destructive"
          }`}>
            {sector.dailyChange > 0 ? "+" : ""}{sector.dailyChange.toFixed(1)}%
          </span>
        </motion.div>
      ))}
    </div>
  );
}