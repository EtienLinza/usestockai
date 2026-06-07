import { ReactNode } from "react";
import { LucideIcon, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  children?: ReactNode;
  className?: string;
  compact?: boolean;
}

/**
 * Standardized empty state. Use when a list or section has no data
 * (no signals yet, no watchlist items, no alerts triggered, etc.).
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  children,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "py-8 px-4" : "py-16 px-6",
        className,
      )}
    >
      <div
        className={cn(
          "rounded-full bg-muted/40 ring-1 ring-border/40 flex items-center justify-center mb-4",
          compact ? "w-10 h-10" : "w-14 h-14",
        )}
      >
        <Icon
          className={cn(
            "text-muted-foreground/70",
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
      {description && (
        <p
          className={cn(
            "text-muted-foreground max-w-sm mt-1.5",
            compact ? "text-xs" : "text-sm",
          )}
        >
          {description}
        </p>
      )}
      {action && (
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          onClick={action.onClick}
          className="mt-5"
        >
          {action.label}
        </Button>
      )}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
