import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  compact?: boolean;
}

/**
 * Standardized error state for failed loads. Pair with React Query's
 * `isError` or try/catch fallbacks. Keep copy calm and actionable.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this just now. Please try again in a moment.",
  onRetry,
  retryLabel = "Try again",
  className,
  compact = false,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "py-8 px-4" : "py-16 px-6",
        className,
      )}
    >
      <div
        className={cn(
          "rounded-full bg-destructive/10 ring-1 ring-destructive/20 flex items-center justify-center mb-4",
          compact ? "w-10 h-10" : "w-14 h-14",
        )}
      >
        <AlertTriangle
          className={cn(
            "text-destructive",
            compact ? "w-5 h-5" : "w-6 h-6",
          )}
          strokeWidth={1.5}
        />
      </div>
      <h3
        className={cn(
          "font-medium text-foreground tracking-tight",
          compact ? "text-sm" : "text-base",
        )}
      >
        {title}
      </h3>
      <p
        className={cn(
          "text-muted-foreground max-w-sm mt-1.5",
          compact ? "text-xs" : "text-sm",
        )}
      >
        {description}
      </p>
      {onRetry && (
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          onClick={onRetry}
          className="mt-5"
        >
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
