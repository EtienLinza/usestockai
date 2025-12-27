import { motion } from "framer-motion";

interface Feature {
  name: string;
  importance: number;
}

interface FeatureImportanceProps {
  features: Feature[];
}

export const FeatureImportance = ({ features }: FeatureImportanceProps) => {
  const maxImportance = Math.max(...features.map((f) => f.importance));

  const getBarColor = (index: number) => {
    const colors = [
      "bg-primary",
      "bg-success",
      "bg-warning",
      "bg-chart-4",
      "bg-destructive",
    ];
    return colors[index % colors.length];
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-muted-foreground mb-4">Feature Importance</h4>
      {features.map((feature, index) => {
        const percentage = (feature.importance / maxImportance) * 100;
        
        return (
          <motion.div
            key={feature.name}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="space-y-1"
          >
            <div className="flex justify-between text-sm">
              <span className="text-foreground font-medium">{feature.name}</span>
              <span className="text-muted-foreground font-mono">
                {(feature.importance * 100).toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${percentage}%` }}
                transition={{ duration: 0.8, delay: index * 0.1, ease: "easeOut" }}
                className={`h-full rounded-full ${getBarColor(index)}`}
              />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};
