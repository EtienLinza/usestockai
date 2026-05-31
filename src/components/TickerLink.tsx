import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface TickerLinkProps {
  ticker: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Wraps a ticker symbol in a link to its detail page. Stops propagation so it
 * works correctly when nested inside clickable rows/cards.
 */
export const TickerLink = ({ ticker, className, children }: TickerLinkProps) => {
  const safe = (ticker || "").toUpperCase();
  return (
    <Link
      to={`/stock/${encodeURIComponent(safe)}`}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "hover:underline underline-offset-2 decoration-primary/60 hover:text-primary transition-colors",
        className,
      )}
      title={`View ${safe} details`}
    >
      {children ?? safe}
    </Link>
  );
};
