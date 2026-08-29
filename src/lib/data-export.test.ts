import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  download,
  downloadRows,
  exportFilename,
  toCSV,
  toJSON,
  toMarkdown,
  type Row,
} from "./data-export";

const rows: Row[] = [
  { ticker: "AAPL", pnl: 12.5, meta: { strategy: "momentum" } },
  { ticker: "MSFT", pnl: -3, meta: null },
];

describe("toCSV", () => {
  it("returns only the header when there are no rows", () => {
    expect(toCSV([], ["a", "b"])).toBe("a,b");
    expect(toCSV([])).toBe("");
  });

  it("derives the union of keys across rows when no columns are given", () => {
    const csv = toCSV([{ a: 1 }, { b: 2 }]);
    expect(csv.split("\n")[0]).toBe("a,b");
    expect(csv.split("\n").slice(1)).toEqual(["1,", ",2"]);
  });

  it("respects an explicit column order and ignores unknown keys", () => {
    expect(toCSV(rows, ["pnl", "ticker"])).toBe("pnl,ticker\n12.5,AAPL\n-3,MSFT");
  });

  it("JSON-stringifies nested values and quotes cells containing separators", () => {
    const csv = toCSV([{ note: 'say "hi", now', meta: { a: 1 }, multi: "l1\nl2" }]);
    expect(csv).toContain('"say ""hi"", now"');
    expect(csv).toContain('"{""a"":1}"');
    expect(csv).toContain('"l1\nl2"');
  });

  it("renders null and undefined as empty cells", () => {
    expect(toCSV([{ a: null, b: undefined }], ["a", "b"])).toBe("a,b\n,");
  });
});

describe("toJSON", () => {
  it("pretty-prints rows with nested detail preserved", () => {
    expect(JSON.parse(toJSON(rows))).toEqual(rows);
    expect(toJSON(rows)).toContain("\n  ");
  });
});

describe("toMarkdown", () => {
  it("emits a header row and separator row", () => {
    const lines = toMarkdown(rows, ["ticker", "pnl"]).split("\n");
    expect(lines[0]).toBe("| ticker | pnl |");
    expect(lines[1]).toBe("| --- | --- |");
    expect(lines[2]).toBe("| AAPL | 12.5 |");
  });

  it("adds a title block with the row count when a title is given", () => {
    const md = toMarkdown(rows, ["ticker"], "Trades");
    expect(md.startsWith("# Trades")).toBe(true);
    expect(md).toContain("_2 rows · exported ");
  });

  it("escapes pipes and collapses newlines so the table stays intact", () => {
    const md = toMarkdown([{ note: "a|b\nc" }], ["note"]);
    expect(md.split("\n")).toHaveLength(3);
    expect(md).toContain("| a\\|b c |");
  });
});

describe("exportFilename", () => {
  it("appends the current UTC date and the extension", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-03-04T10:00:00Z"));
    expect(exportFilename("signals", "csv")).toBe("signals-2025-03-04.csv");
    vi.useRealTimers();
  });
});

describe("download", () => {
  let click: ReturnType<typeof vi.fn>;
  let createObjectURL: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    click = vi.fn();
    createObjectURL = vi.fn((_blob: Blob) => "blob:mock");
    revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("clicks a temporary anchor and cleans up the object URL", () => {
    download("report.csv", "a,b", "text/csv");

    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0][0].type).toBe("text/csv");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });

  it("downloadRows picks the filename and mime type per format", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-03-04T10:00:00Z"));
    const anchors: { name: string; type: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchors.push({
        name: this.download,
        type: createObjectURL.mock.calls.at(-1)![0].type,
      });
    });

    downloadRows(rows, "csv", "log");
    downloadRows(rows, "json", "log");
    downloadRows(rows, "md", "log", ["ticker"], "Log");

    expect(anchors).toEqual([
      { name: "log-2025-03-04.csv", type: "text/csv" },
      { name: "log-2025-03-04.json", type: "application/json" },
      { name: "log-2025-03-04.md", type: "text/markdown" },
    ]);
    vi.useRealTimers();
  });
});
