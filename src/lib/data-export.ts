// Generic export helpers for detailed data / log downloads.
// Three non-overlapping formats:
//   • CSV      — flat, spreadsheet-friendly (nested values JSON-stringified)
//   • JSON     — full nested detail preserved (arrays/objects intact)
//   • Markdown — human-readable table for reports & sharing

export type Row = Record<string, unknown>;

export function download(filename: string, content: BlobPart, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().split("T")[0];
export const exportFilename = (label: string, ext: string) =>
  `${label}-${stamp()}.${ext}`;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function mdEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function toCSV(rows: Row[], columns?: string[]): string {
  if (rows.length === 0) return (columns ?? []).join(",");
  const cols = columns ?? Array.from(rows.reduce((s, r) => {
    Object.keys(r).forEach((k) => s.add(k));
    return s;
  }, new Set<string>()));
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvEscape(r[c])).join(","));
  return lines.join("\n");
}

export function toJSON(rows: Row[]): string {
  return JSON.stringify(rows, null, 2);
}

export function toMarkdown(rows: Row[], columns?: string[], title?: string): string {
  const cols = columns ?? Array.from(rows.reduce((s, r) => {
    Object.keys(r).forEach((k) => s.add(k));
    return s;
  }, new Set<string>()));
  const out: string[] = [];
  if (title) out.push(`# ${title}`, "", `_${rows.length} rows · exported ${new Date().toISOString()}_`, "");
  out.push(`| ${cols.join(" | ")} |`);
  out.push(`| ${cols.map(() => "---").join(" | ")} |`);
  for (const r of rows) out.push(`| ${cols.map((c) => mdEscape(r[c])).join(" | ")} |`);
  return out.join("\n");
}

export type ExportFormat = "csv" | "json" | "md";

export function downloadRows(
  rows: Row[],
  format: ExportFormat,
  label: string,
  columns?: string[],
  title?: string,
) {
  if (format === "csv") {
    download(exportFilename(label, "csv"), toCSV(rows, columns), "text/csv");
  } else if (format === "json") {
    download(exportFilename(label, "json"), toJSON(rows), "application/json");
  } else {
    download(exportFilename(label, "md"), toMarkdown(rows, columns, title), "text/markdown");
  }
}
