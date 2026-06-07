import { Skeleton } from "@/components/ui/skeleton";

/**
 * Content-shaped skeleton shown while a lazy-loaded route bundle is fetched.
 * Mirrors the typical app layout: header band + a few card rows.
 */
export function PageSkeleton() {
  return (
    <div
      className="min-h-screen w-full bg-background"
      aria-busy="true"
      aria-label="Loading page"
    >
      {/* Top nav placeholder */}
      <div className="h-16 border-b border-border/40 flex items-center px-4 sm:px-6 gap-4">
        <Skeleton className="h-7 w-28 rounded-md" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Title */}
        <div className="space-y-2">
          <Skeleton className="h-7 w-48 rounded-md" />
          <Skeleton className="h-4 w-72 rounded-md opacity-70" />
        </div>

        {/* Metric row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>

        {/* Content cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>

        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  );
}
