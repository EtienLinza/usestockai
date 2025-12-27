import { motion } from "framer-motion";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export const Logo = ({ size = "md", showText = true }: LogoProps) => {
  const sizes = {
    sm: { icon: 28, text: "text-lg" },
    md: { icon: 36, text: "text-xl" },
    lg: { icon: 48, text: "text-3xl" },
  };

  const { icon, text } = sizes[size];

  return (
    <motion.div 
      className="flex items-center gap-2"
      whileHover={{ scale: 1.02 }}
      transition={{ type: "spring", stiffness: 400 }}
    >
      <div className="relative">
        <svg
          width={icon}
          height={icon}
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="drop-shadow-[0_0_10px_hsl(187_100%_42%/0.5)]"
        >
          {/* Outer ring */}
          <circle
            cx="24"
            cy="24"
            r="22"
            stroke="url(#gradient-ring)"
            strokeWidth="2"
            fill="none"
          />
          {/* Inner glow */}
          <circle
            cx="24"
            cy="24"
            r="18"
            fill="url(#gradient-center)"
            opacity="0.15"
          />
          {/* Chart bars */}
          <rect x="14" y="26" width="4" height="10" rx="1" fill="url(#gradient-bar)" />
          <rect x="22" y="20" width="4" height="16" rx="1" fill="url(#gradient-bar)" />
          <rect x="30" y="14" width="4" height="22" rx="1" fill="url(#gradient-bar)" />
          {/* Trend line */}
          <path
            d="M12 30 L18 24 L26 18 L36 12"
            stroke="url(#gradient-line)"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
          {/* Star/AI indicator */}
          <circle cx="36" cy="12" r="3" fill="hsl(187 100% 50%)" />
          
          <defs>
            <linearGradient id="gradient-ring" x1="0" y1="0" x2="48" y2="48">
              <stop offset="0%" stopColor="hsl(187 100% 50%)" />
              <stop offset="100%" stopColor="hsl(200 100% 60%)" />
            </linearGradient>
            <linearGradient id="gradient-center" x1="24" y1="6" x2="24" y2="42">
              <stop offset="0%" stopColor="hsl(187 100% 50%)" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
            <linearGradient id="gradient-bar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(187 100% 50%)" />
              <stop offset="100%" stopColor="hsl(187 100% 35%)" />
            </linearGradient>
            <linearGradient id="gradient-line" x1="12" y1="30" x2="36" y2="12">
              <stop offset="0%" stopColor="hsl(145 65% 50%)" />
              <stop offset="100%" stopColor="hsl(187 100% 50%)" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      {showText && (
        <span className={`font-bold ${text} tracking-tight`}>
          <span className="text-gradient">God</span>
          <span className="text-foreground">Stock</span>
          <span className="text-primary">AI</span>
        </span>
      )}
    </motion.div>
  );
};
