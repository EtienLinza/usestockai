// Backtest export helpers — multiple formats including the full trade log.
// Kept UI-agnostic so it can be reused elsewhere.

type AnyReport = any;

function download(filename: string, content: BlobPart, mime: string) {
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
const fname = (label: string, ext: string) => `backtest-${label}-${stamp()}.${ext}`;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(rows: (string | number | null | undefined)[][]): string {
  return rows.map(r => r.map(csvEscape).join(",")).join("\n");
}

// ---------- Summary CSV (metrics only) ----------
export function exportSummaryCSV(report: AnyReport) {
  const rows: (string | number)[][] = [
    ["Metric", "Value"],
    ["Total Trades", report.totalTrades],
    ["Win Rate %", report.winRate],
    ["Total Return %", report.totalReturn],
    ["CAGR %", report.cagr],
    ["Annualized Return %", report.annualizedReturn],
    ["Benchmark Return %", report.benchmarkReturn],
    ["Sharpe Ratio", report.sharpeRatio],
    ["Deflated Sharpe", report.deflatedSharpe ?? ""],
    ["Sortino Ratio", report.sortinoRatio],
    ["Calmar Ratio", report.calmarRatio],
    ["Profit Factor", report.profitFactor],
    ["Max Drawdown %", report.maxDrawdown],
    ["Max DD Duration (bars)", report.maxDrawdownDuration],
    ["Recovery Time (bars)", report.recoveryTime],
    ["Time In Drawdown %", report.timeInDrawdownPct],
    ["Alpha %", report.alpha],
    ["Beta", report.beta],
    ["VaR (5%) %", report.valueAtRisk],
    ["CVaR %", report.conditionalVaR],
    ["Ulcer Index", report.ulcerIndex],
    ["Avg Win %", report.avgWin],
    ["Avg Loss %", report.avgLoss],
    ["Win/Loss Ratio", report.winLossRatio],
    ["Expectancy %", report.expectancy],
    ["Kelly", report.kelly],
    ["Skewness", report.skewness],
    ["Kurtosis", report.kurtosis],
    ["Max Consec Wins", report.maxConsecutiveWins],
    ["Max Consec Losses", report.maxConsecutiveLosses],
    ["Avg Duration (bars)", report.avgTradeDuration],
    ["Median Duration (bars)", report.medianTradeDuration],
    ["Max Duration (bars)", report.maxTradeDuration],
    ["Market Exposure %", report.marketExposure],
    ["Long Exposure %", report.longExposure],
    ["Short Exposure %", report.shortExposure],
    ["Portfolio Turnover", report.portfolioTurnover],
    ["Stability Score", report.stabilityScore],
    ["Signal Precision", report.signalPrecision],
    ["Signal Recall", report.signalRecall],
    ["Signal F1", report.signalF1],
    ["Directional Accuracy", report.directionalAccuracy],
    ["Strategy Capacity ($)", report.strategyCapacity ?? ""],
    ["Liquidity Warnings", report.liquidityWarnings],
  ];
  download(fname("summary", "csv"), toCSV(rows), "text/csv");
}

// ---------- Full Trade Log CSV ----------
export function exportTradeLogCSV(report: AnyReport) {
  const header = [
    "EntryDate", "ExitDate", "Ticker", "Action", "Strategy", "ExitReason",
    "EntryPrice", "ExitPrice", "ReturnPct", "PnL", "DurationBars",
    "MAE_Pct", "MFE_Pct", "Regime", "Confidence",
  ];
  const rows: (string | number)[][] = [header];
  for (const t of report.tradeLog ?? []) {
    rows.push([
      t.date, t.exitDate, t.ticker, t.action, t.strategy ?? "", t.exitReason ?? "",
      Number(t.entryPrice).toFixed(4), Number(t.exitPrice).toFixed(4),
      Number(t.returnPct).toFixed(4), Number(t.pnl).toFixed(2), t.duration,
      t.mae, t.mfe, t.regime, t.confidence,
    ]);
  }
  download(fname("trades", "csv"), toCSV(rows), "text/csv");
}

// ---------- Equity + Drawdown Curve CSV ----------
export function exportEquityCurveCSV(report: AnyReport) {
  const rows: (string | number)[][] = [["Date", "StrategyEquity", "BenchmarkEquity", "DrawdownPct"]];
  const benchMap = new Map<string, number>();
  for (const b of report.benchmarkEquity ?? []) benchMap.set(b.date, b.value);
  const ddMap = new Map<string, number>();
  for (const d of report.drawdownCurve ?? []) ddMap.set(d.date, d.drawdown);
  for (const e of report.equityCurve ?? []) {
    rows.push([e.date, Number(e.value).toFixed(4), benchMap.get(e.date) ?? "", ddMap.get(e.date) ?? ""]);
  }
  download(fname("equity", "csv"), toCSV(rows), "text/csv");
}

// ---------- Full JSON ----------
export function exportJSON(report: AnyReport) {
  download(fname("full", "json"), JSON.stringify(report, null, 2), "application/json");
}

// ---------- Markdown report ----------
export function exportMarkdown(report: AnyReport) {
  const lines: string[] = [];
  lines.push(`# Backtest Report — ${stamp()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---:|");
  const push = (k: string, v: unknown) => lines.push(`| ${k} | ${v ?? "—"} |`);
  push("Total Trades", report.totalTrades);
  push("Win Rate", `${report.winRate}%`);
  push("Total Return", `${report.totalReturn}%`);
  push("CAGR", `${report.cagr}%`);
  push("Benchmark Return", `${report.benchmarkReturn}%`);
  push("Sharpe", report.sharpeRatio);
  push("Deflated Sharpe", report.deflatedSharpe);
  push("Sortino", report.sortinoRatio);
  push("Calmar", report.calmarRatio);
  push("Profit Factor", report.profitFactor);
  push("Max Drawdown", `${report.maxDrawdown}%`);
  push("Alpha", `${report.alpha}%`);
  push("Beta", report.beta);
  push("VaR (5%)", `${report.valueAtRisk}%`);
  push("CVaR", `${report.conditionalVaR}%`);
  push("Expectancy", `${report.expectancy}%`);
  push("Kelly", report.kelly);

  if (report.strategyPerformance?.length) {
    lines.push("", "## Strategy Performance", "", "| Strategy | Trades | Win Rate | Avg Return |", "|---|---:|---:|---:|");
    for (const s of report.strategyPerformance) {
      lines.push(`| ${s.strategy} | ${s.trades} | ${s.winRate}% | ${s.avgReturn}% |`);
    }
  }

  if (report.regimePerformance?.length) {
    lines.push("", "## Regime Performance", "", "| Regime | Trades | Accuracy | Avg Return |", "|---|---:|---:|---:|");
    for (const r of report.regimePerformance) {
      lines.push(`| ${r.regime} | ${r.trades} | ${r.accuracy}% | ${r.avgReturn}% |`);
    }
  }

  lines.push("", "## Trade Log", "", "| # | Entry | Exit | Ticker | Action | Strategy | Entry $ | Exit $ | Return % | PnL | Bars | Regime | Conf |");
  lines.push("|---:|---|---|---|---|---|---:|---:|---:|---:|---:|---|---:|");
  (report.tradeLog ?? []).forEach((t: any, i: number) => {
    lines.push(`| ${i + 1} | ${t.date} | ${t.exitDate} | ${t.ticker} | ${t.action} | ${t.strategy ?? ""} | ${Number(t.entryPrice).toFixed(2)} | ${Number(t.exitPrice).toFixed(2)} | ${Number(t.returnPct).toFixed(2)} | ${Number(t.pnl).toFixed(2)} | ${t.duration} | ${t.regime} | ${t.confidence} |`);
  });

  lines.push("", "---", "_Generated by StockAI. Not financial advice._");
  download(fname("report", "md"), lines.join("\n"), "text/markdown");
}

// ---------- HTML report (also usable as PDF via browser print) ----------
export function exportHTML(report: AnyReport, opts: { print?: boolean } = {}) {
  const esc = (v: unknown) =>
    String(v ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const metric = (label: string, value: unknown, cls = "") =>
    `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value ${cls}">${esc(value)}</div></div>`;

  const tradesRows = (report.tradeLog ?? []).map((t: any, i: number) => `
    <tr class="${Number(t.returnPct) >= 0 ? "pos" : "neg"}">
      <td>${i + 1}</td><td>${esc(t.date)}</td><td>${esc(t.exitDate)}</td>
      <td>${esc(t.ticker)}</td><td>${esc(t.action)}</td><td>${esc(t.strategy ?? "")}</td>
      <td class="num">${Number(t.entryPrice).toFixed(2)}</td>
      <td class="num">${Number(t.exitPrice).toFixed(2)}</td>
      <td class="num">${Number(t.returnPct).toFixed(2)}%</td>
      <td class="num">${Number(t.pnl).toFixed(2)}</td>
      <td class="num">${t.duration}</td>
      <td>${esc(t.regime)}</td>
      <td class="num">${esc(t.confidence)}</td>
      <td>${esc(t.exitReason ?? "")}</td>
    </tr>`).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
<title>StockAI Backtest Report — ${stamp()}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#0a0a0a; color:#fafafa; margin:0; padding:40px; }
  h1 { font-size:28px; margin:0 0 4px; font-weight:500; }
  h2 { font-size:16px; margin:28px 0 12px; color:#5a8a6a; text-transform:uppercase; letter-spacing:.06em; font-weight:600; }
  .muted { color:#737373; font-size:12px; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:16px 0 8px; }
  .stat { background:#141414; border:1px solid #262626; padding:14px; border-radius:8px; }
  .stat-label { font-size:10px; color:#737373; text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px; }
  .stat-value { font-size:20px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .pos { color:#5a8a6a; } .neg { color:#ef4444; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  th, td { padding:6px 8px; border-bottom:1px solid #1f1f1f; text-align:left; }
  th { color:#a3a3a3; font-weight:500; background:#141414; position:sticky; top:0; }
  td.num { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; text-align:right; }
  tr.pos td.num:nth-child(9), tr.pos td.num:nth-child(10) { color:#5a8a6a; }
  tr.neg td.num:nth-child(9), tr.neg td.num:nth-child(10) { color:#ef4444; }
  .disclaimer { margin-top:24px; padding:12px; background:#1a1a0f; border:1px solid #3d3d00; border-radius:8px; font-size:11px; color:#a3a3a3; }
  @media print { body { background:#fff; color:#000; padding:20px; } .stat,th { background:#f5f5f5; } th { color:#333; } .disclaimer { background:#fffbe6; color:#333; } }
</style></head><body>
<h1>StockAI Backtest Report</h1>
<div class="muted">Generated ${stamp()} · ${esc(report.totalTrades ?? 0)} trades</div>

<h2>Headline Metrics</h2>
<div class="stats">
  ${metric("Total Return", `${report.totalReturn}%`, Number(report.totalReturn) >= 0 ? "pos" : "neg")}
  ${metric("CAGR", `${report.cagr}%`)}
  ${metric("Win Rate", `${report.winRate}%`)}
  ${metric("Max Drawdown", `-${report.maxDrawdown}%`, "neg")}
  ${metric("Sharpe", report.sharpeRatio)}
  ${metric("Sortino", report.sortinoRatio)}
  ${metric("Calmar", report.calmarRatio)}
  ${metric("Profit Factor", report.profitFactor)}
  ${metric("Alpha", `${report.alpha}%`)}
  ${metric("Beta", report.beta)}
  ${metric("Expectancy", `${report.expectancy}%`)}
  ${metric("Kelly", report.kelly)}
</div>

<h2>Trade Log (${(report.tradeLog ?? []).length})</h2>
<table>
  <thead><tr>
    <th>#</th><th>Entry</th><th>Exit</th><th>Ticker</th><th>Action</th><th>Strategy</th>
    <th>Entry</th><th>Exit</th><th>Return</th><th>PnL</th><th>Bars</th><th>Regime</th><th>Conf</th><th>Exit Reason</th>
  </tr></thead>
  <tbody>${tradesRows}</tbody>
</table>

<div class="disclaimer">⚠️ AI-generated analysis for informational purposes only. Not financial advice.</div>
</body></html>`;

  if (opts.print) {
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 400);
    }
  } else {
    download(fname("report", "html"), html, "text/html");
  }
}

// ---------- Excel-compatible SpreadsheetML (.xls with multiple sheets) ----------
export function exportExcel(report: AnyReport) {
  const sheet = (name: string, rows: (string | number | null | undefined)[][]) => {
    const cells = rows.map(r => "<Row>" + r.map(c => {
      const isNum = typeof c === "number" && Number.isFinite(c);
      const type = isNum ? "Number" : "String";
      const val = c === null || c === undefined ? "" : String(c)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<Cell><Data ss:Type="${type}">${val}</Data></Cell>`;
    }).join("") + "</Row>").join("");
    return `<Worksheet ss:Name="${name.replace(/[^\w -]/g, "_").slice(0, 31)}"><Table>${cells}</Table></Worksheet>`;
  };

  const summary: (string | number)[][] = [
    ["Metric", "Value"],
    ["Total Trades", report.totalTrades],
    ["Win Rate %", report.winRate],
    ["Total Return %", report.totalReturn],
    ["CAGR %", report.cagr],
    ["Sharpe", report.sharpeRatio],
    ["Sortino", report.sortinoRatio],
    ["Calmar", report.calmarRatio],
    ["Profit Factor", report.profitFactor],
    ["Max Drawdown %", report.maxDrawdown],
    ["Alpha %", report.alpha],
    ["Beta", report.beta],
    ["VaR (5%) %", report.valueAtRisk],
    ["CVaR %", report.conditionalVaR],
    ["Expectancy %", report.expectancy],
    ["Kelly", report.kelly],
  ];

  const trades: (string | number)[][] = [[
    "EntryDate", "ExitDate", "Ticker", "Action", "Strategy", "ExitReason",
    "EntryPrice", "ExitPrice", "ReturnPct", "PnL", "DurationBars",
    "MAE", "MFE", "Regime", "Confidence",
  ]];
  for (const t of report.tradeLog ?? []) {
    trades.push([
      t.date, t.exitDate, t.ticker, t.action, t.strategy ?? "", t.exitReason ?? "",
      Number(t.entryPrice), Number(t.exitPrice), Number(t.returnPct), Number(t.pnl), Number(t.duration),
      Number(t.mae), Number(t.mfe), t.regime, Number(t.confidence),
    ]);
  }

  const equity: (string | number)[][] = [["Date", "Strategy", "Benchmark", "Drawdown"]];
  const benchMap = new Map<string, number>();
  for (const b of report.benchmarkEquity ?? []) benchMap.set(b.date, b.value);
  const ddMap = new Map<string, number>();
  for (const d of report.drawdownCurve ?? []) ddMap.set(d.date, d.drawdown);
  for (const e of report.equityCurve ?? []) {
    equity.push([e.date, Number(e.value), benchMap.get(e.date) ?? "", ddMap.get(e.date) ?? ""]);
  }

  const monthly: (string | number)[][] = [["Year", "Month", "ReturnPct"]];
  for (const m of report.monthlyReturns ?? []) monthly.push([m.year, m.month, m.returnPct]);

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${sheet("Summary", summary)}
${sheet("Trades", trades)}
${sheet("Equity", equity)}
${sheet("Monthly", monthly)}
</Workbook>`;
  download(fname("workbook", "xls"), xml, "application/vnd.ms-excel");
}
