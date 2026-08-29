import { forwardRef } from "react";
import { motion } from "framer-motion";
import logoAsset from "@/assets/stockai-logo.jpeg.asset.json";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export const Logo = forwardRef<HTMLDivElement, LogoProps>(
  ({ size = "md", showText = true }, ref) => {
    const sizes = {
      sm: { icon: 28, text: "text-lg" },
      md: { icon: 36, text: "text-2xl" },
      lg: { icon: 52, text: "text-4xl" },
    };

    const { icon, text } = sizes[size];

    return (
      <motion.div 
        ref={ref}
        className="flex items-center gap-2"
        whileHover={{ scale: 1.01 }}
        transition={{ type: "spring", stiffness: 400 }}
      >
        <img
          src={logoAsset.url}
          width={icon}
          height={icon}
          alt={showText ? "" : "StockAI"}
          className="block shrink-0 object-contain"
        />
        {showText && (
          <span className={`font-bold ${text}`}>
            <span className="text-foreground">Stock</span>
            <span className="text-primary">AI</span>
          </span>
        )}
      </motion.div>
    );
  }
);

Logo.displayName = "Logo";
