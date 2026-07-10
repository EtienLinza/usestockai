import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Download, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { downloadRows, type ExportFormat, type Row } from "@/lib/data-export";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface ExportDataset {
  /** stable key used in checkbox state + filenames */
  key: string;
  /** display label */
  label: string;
  /** Supabase table name */
  table: string;
  /** Column used for date range filtering (e.g. "created_at") */
  dateColumn: string;
  /** Optional column allowlist. When omitted, exports every column returned. */
  columns?: string[];
  /** Optional extra .eq() filters — e.g. { is_dismissed: false } */
  filters?: Record<string, unknown>;
  /** Human-readable filename slug (defaults to key) */
  filenameSlug?: string;
  /** Set false for public tables that have no user_id column (e.g. live_signals). Defaults to true. */
  scopeToUser?: boolean;
}

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  userId: string;
  datasets: ExportDataset[];
}


export function ExportDialog({
  open, onOpenChange, title, description, userId, datasets,
}: ExportDialogProps) {

  const [selected, setSelected] = useState<Set<string>>(new Set(datasets.map((d) => d.key)));
  const [from, setFrom] = useState<Date | undefined>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  });
  const [to, setTo] = useState<Date | undefined>(new Date());
  const [fmt, setFmt] = useState<ExportFormat>("csv");
  const [busy, setBusy] = useState(false);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const run = async () => {
    if (selected.size === 0) {
      toast.error("Pick at least one dataset");
      return;
    }
    if (!from || !to) {
      toast.error("Pick a date range");
      return;
    }
    setBusy(true);
    try {
      const fromISO = new Date(from.getFullYear(), from.getMonth(), from.getDate()).toISOString();
      const toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999).toISOString();

      const targets = datasets.filter((d) => selected.has(d.key));
      let totalRows = 0;

      for (const ds of targets) {
        let q = supabase
          .from(ds.table as never)
          .select(ds.columns?.join(",") ?? "*")
          .gte(ds.dateColumn, fromISO)
          .lte(ds.dateColumn, toEnd)
          .order(ds.dateColumn, { ascending: false })
          .limit(50000);
        if (scopeToUser) q = q.eq("user_id", userId);
        for (const [k, v] of Object.entries(ds.filters ?? {})) q = q.eq(k, v as never);

        const { data, error } = await q;
        if (error) throw error;
        const rows = (data ?? []) as unknown as Row[];
        totalRows += rows.length;

        const label = ds.filenameSlug ?? ds.key;
        const filename = `${label}-${format(from, "yyyyMMdd")}-${format(to, "yyyyMMdd")}`;
        downloadRows(rows, fmt, filename, ds.columns, `${ds.label} — ${format(from, "PP")} to ${format(to, "PP")}`);
      }

      toast.success(`Exported ${targets.length} dataset${targets.length > 1 ? "s" : ""} · ${totalRows} rows`);
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Export failed";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-4 h-4" /> {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
              Datasets
            </label>
            <div className="space-y-2">
              {datasets.map((d) => (
                <label
                  key={d.key}
                  className="flex items-center gap-2 rounded-md border border-border/40 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
                >
                  <Checkbox
                    checked={selected.has(d.key)}
                    onCheckedChange={() => toggle(d.key)}
                  />
                  <span className="text-sm">{d.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">From</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !from && "text-muted-foreground")}>
                    <CalendarIcon className="w-4 h-4 mr-2" />
                    {from ? format(from, "PP") : "Pick date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-50" align="start">
                  <Calendar mode="single" selected={from} onSelect={setFrom} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">To</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !to && "text-muted-foreground")}>
                    <CalendarIcon className="w-4 h-4 mr-2" />
                    {to ? format(to, "PP") : "Pick date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-50" align="start">
                  <Calendar mode="single" selected={to} onSelect={setTo} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Format</label>
            <Select value={fmt} onValueChange={(v) => setFmt(v as ExportFormat)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV — flat, spreadsheet-friendly</SelectItem>
                <SelectItem value="json">JSON — full nested detail (arrays preserved)</SelectItem>
                <SelectItem value="md">Markdown — human-readable table</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            {busy ? "Exporting…" : "Download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
