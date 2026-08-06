import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportEquityCurveCSV,
  exportExcel,
  exportHTML,
  exportJSON,
  exportMarkdown,
  exportSummaryCSV,
  exportTradeLogCSV,
} from "./backtest-export";

const report = {
  totalTrades: 2,
  winRate: 50,
  totalReturn: 12.34,
  cagr: 6.1,
  annualizedReturn: 6.4,
  benchmarkReturn: 8,
  sharpeRatio: 1.2,
  sortinoRatio: 1.6,
  calmarRatio: 0.9,
  profitFactor: 1.4,
  maxDrawdown: 9.5,
  alpha: 4.3,
  beta: 0.8,
  valueAtRisk: 2.1,
  conditionalVaR: 3.2,
  expectancy: 0.7,
  kelly: 0.15,
  tradeLog: [
    {
      date: "2025-01-02",
      exitDate: "2025-01-09",
      ticker: "AAPL",
      action: "BUY",
      strategy: "momentum",
      exitReason: "target",
      entryPrice: 100.123456,
      exitPrice: 110.5,
      returnPct: 10.377,
      pnl: 1037.7,
      duration: 5,
      mae: -1.2,
      mfe: 11,
      regime: "bull",
      confidence: 72,
    },
    {
      date: "2025-02-03",
      exitDate: "2025-02-05",
      ticker: "MSFT & CO",
      action: "SELL",
      entryPrice: 200,
      exitPrice: 190,
      returnPct: -5,
      pnl: -500,
      duration: 2,
      mae: -6,
      mfe: 0.5,
      regime: "bear",
      confidence: 51,
    },
  ],
  equityCurve: [
    { date: "2025-01-02", value: 10000 },
    { date: "2025-01-03", value: 10500.5 },
  ],
  benchmarkEquity: [{ date: "2025-01-02", value: 10000 }],
  drawdownCurve: [{ date: "2025-01-03", drawdown: -1.5 }],
  monthlyReturns: [{ year: 2025, month: 1, returnPct: 5 }],
  strategyPerformance: [{ strategy: "momentum", trades: 1, winRate: 100, avgReturn: 10.38 }],
  regimePerformance: [{ regime: "bull", trades: 1, accuracy: 100, avgReturn: 10.38 }],
};

// jsdom's Blob#text() is async while the export helpers are synchronous, so the
// Blob constructor is recorded to capture what each download would contain.
let downloads: { name: string; type: string; content: string }[];
const blobContents = new WeakMap<Blob, string>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-03-04T10:00:00Z"));
  downloads = [];

  const NativeBlob = globalThis.Blob;
  vi.stubGlobal(
    "Blob",
    class extends NativeBlob {
      constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
        super(parts, options);
        blobContents.set(this, parts.map(String).join(""));
      }
    },
  );

  const createObjectURL = vi.fn((_blob: Blob) => "blob:mock");
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const blob = createObjectURL.mock.calls.at(-1)![0];
    downloads.push({ name: this.download, type: blob.type, content: blobContents.get(blob) ?? "" });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const only = () => {
  expect(downloads).toHaveLength(1);
  return downloads[0];
};

describe("exportSummaryCSV", () => {
  it("writes a two-column metric table, blanking optional metrics", () => {
    exportSummaryCSV(report);
    const file = only();

    expect(file).toMatchObject({ name: "backtest-summary-2025-03-04.csv", type: "text/csv" });
    const lines = file.content.split("\n");
    expect(lines[0]).toBe("Metric,Value");
    expect(lines).toContain("Total Trades,2");
    expect(lines).toContain("Sharpe Ratio,1.2");
    expect(lines).toContain("Deflated Sharpe,");
    expect(lines).toContain("Strategy Capacity ($),");
  });
});

describe("exportTradeLogCSV", () => {
  it("emits one row per trade with fixed-precision prices", () => {
    exportTradeLogCSV(report);
    const lines = only().content.split("\n");

    expect(lines[0].startsWith("EntryDate,ExitDate,Ticker")).toBe(true);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("100.1235,110.5000,10.3770,1037.70");
    expect(lines[2]).toContain("2025-02-03,2025-02-05,MSFT & CO,SELL,,");
  });

  it("writes only the header when there is no trade log", () => {
    exportTradeLogCSV({ ...report, tradeLog: undefined });
    expect(only().content.split("\n")).toHaveLength(1);
  });
});

describe("exportEquityCurveCSV", () => {
  it("joins benchmark and drawdown series onto the equity dates", () => {
    exportEquityCurveCSV(report);
    const lines = only().content.split("\n");

    expect(lines[0]).toBe("Date,StrategyEquity,BenchmarkEquity,DrawdownPct");
    expect(lines[1]).toBe("2025-01-02,10000.0000,10000,");
    expect(lines[2]).toBe("2025-01-03,10500.5000,,-1.5");
  });
});

describe("exportJSON", () => {
  it("round-trips the whole report", () => {
    exportJSON(report);
    const file = only();

    expect(file.name).toBe("backtest-full-2025-03-04.json");
    expect(file.type).toBe("application/json");
    expect(JSON.parse(file.content)).toEqual(report);
  });
});

describe("exportMarkdown", () => {
  it("includes summary, per-strategy, per-regime and trade tables", () => {
    exportMarkdown(report);
    const md = only().content;

    expect(md).toContain("# Backtest Report — 2025-03-04");
    expect(md).toContain("| Total Return | 12.34% |");
    expect(md).toContain("## Strategy Performance");
    expect(md).toContain("| momentum | 1 | 100% | 10.38% |");
    expect(md).toContain("## Regime Performance");
    expect(md).toContain("| 1 | 2025-01-02 | 2025-01-09 | AAPL | BUY | momentum | 100.12 | 110.50");
  });

  it("renders missing metrics as an em dash and drops empty breakdown sections", () => {
    exportMarkdown({ ...report, kelly: null, strategyPerformance: [], regimePerformance: [] });
    const md = only().content;

    expect(md).toContain("| Kelly | — |");
    expect(md).not.toContain("## Strategy Performance");
    expect(md).not.toContain("## Regime Performance");
  });
});

describe("exportHTML", () => {
  it("escapes report values into the trade table", () => {
    exportHTML(report);
    const file = only();

    expect(file).toMatchObject({ name: "backtest-report-2025-03-04.html", type: "text/html" });
    expect(file.content).toContain("MSFT &amp; CO");
    expect(file.content).toContain('<tr class="pos">');
    expect(file.content).toContain('<tr class="neg">');
  });

  it("prints to a new window instead of downloading when print is requested", () => {
    const printWindow = {
      document: { write: vi.fn(), close: vi.fn() },
      print: vi.fn(),
    };
    vi.stubGlobal("open", vi.fn(() => printWindow));

    exportHTML(report, { print: true });
    vi.advanceTimersByTime(400);

    expect(downloads).toHaveLength(0);
    expect(printWindow.document.write).toHaveBeenCalledOnce();
    expect(printWindow.document.close).toHaveBeenCalledOnce();
    expect(printWindow.print).toHaveBeenCalledOnce();
  });

  it("does nothing when the popup is blocked", () => {
    vi.stubGlobal("open", vi.fn(() => null));
    expect(() => exportHTML(report, { print: true })).not.toThrow();
    expect(downloads).toHaveLength(0);
  });
});

describe("exportExcel", () => {
  it("builds a four-sheet SpreadsheetML workbook with typed cells", () => {
    exportExcel(report);
    const file = only();

    expect(file).toMatchObject({
      name: "backtest-workbook-2025-03-04.xls",
      type: "application/vnd.ms-excel",
    });
    for (const name of ["Summary", "Trades", "Equity", "Monthly"]) {
      expect(file.content).toContain(`<Worksheet ss:Name="${name}">`);
    }
    expect(file.content).toContain('<Data ss:Type="Number">1.2</Data>');
    expect(file.content).toContain('<Data ss:Type="String">Sharpe</Data>');
    expect(file.content).toContain("MSFT &amp; CO");
  });
});
