import { motion } from "framer-motion";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export const Logo = ({ size = "md", showText = true }: LogoProps) => {
  const sizes = {
    sm: { icon: 24, text: "text-base" },
    md: { icon: 32, text: "text-xl" },
    lg: { icon: 44, text: "text-3xl" },
  };

  const { icon, text } = sizes[size];

  return (
    <motion.div 
      className="flex items-center gap-2"
      whileHover={{ scale: 1.01 }}
      transition={{ type: "spring", stiffness: 400 }}
    >
      <div className="relative">
        <svg
          width={icon}
          height={icon}
          viewBox="0 0 44 44"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Minimal circle */}
          <circle
            cx="22"
            cy="22"
            r="20"
            stroke="hsl(143 35% 45%)"
            strokeWidth="1"
            fill="none"
            opacity="0.3"
          />
          {/* Trend line */}
          <path
            d="M10 28 L18 22 L26 18 L34 12"
            stroke="hsl(143 35% 45%)"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
          {/* Prediction dot with glow */}
          <circle cx="34" cy="12" r="3" fill="hsl(143 40% 50%)" />
          <circle cx="34" cy="12" r="5" fill="hsl(143 40% 50%)" opacity="0.2" />
        </svg>
      </div>
      {showText && (
        <span className={`font-medium ${text} tracking-tight`}>
          <span className="text-foreground">Stock</span>
          <span className="text-primary">AI</span>
        </span>
      )}
    </motion.div>
  );
};