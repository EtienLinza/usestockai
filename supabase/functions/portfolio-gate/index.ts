import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Sector mapping (mirrors market-scanner) ──────────────────────────────────
const TICKER_TO_SECTOR_ETF: Record<string, string> = {
  // Technology
  AAPL: "XLK", MSFT: "XLK", NVDA: "XLK", GOOGL: "XLK", GOOG: "XLK", META: "XLK",
  AVGO: "XLK", AMD: "XLK", INTC: "XLK", CRM: "XLK", ADBE: "XLK", ORCL: "XLK",
  CSCO: "XLK", IBM: "XLK", QCOM: "XLK", TXN: "XLK", AMAT: "XLK", MU: "XLK",
  NOW: "XLK", PANW: "XLK", SNOW: "XLK", PLTR: "XLK",
  // Healthcare
  UNH: "XLV", JNJ: "XLV", LLY: "XLV", PFE: "XLV", ABBV: "XLV", MRK: "XLV",
  TMO: "XLV", ABT: "XLV", DHR: "XLV", BMY: "XLV", AMGN: "XLV", GILD: "XLV",
  // Financials
  JPM: "XLF", BAC: "XLF", WFC: "XLF", GS: "XLF", MS: "XLF", C: "XLF",
  BLK: "XLF", SCHW: "XLF", AXP: "XLF", V: "XLF", MA: "XLF", PYPL: "XLF",
  // Energy
  XOM: "XLE", CVX: "XLE", COP: "XLE", SLB: "XLE", EOG: "XLE", OXY: "XLE",
  // Consumer Discretionary
  AMZN: "XLY", TSLA: "XLY", HD: "XLY", NKE: "XLY", MCD: "XLY", LOW: "XLY",
  SBUX: "XLY", BKNG: "XLY", TJX: "XLY",
  // Communication Services
  NFLX: "XLC", DIS: "XLC", CMCSA: "XLC", T: "XLC", VZ: "XLC", TMUS: "XLC",
  // Consumer Staples
  WMT: "XLP", PG: "XLP", KO: "XLP", PEP: "XLP", COST: "XLP", PM: "XLP",
  // Industrials
  CAT: "XLI", BA: "XLI", GE: "XLI", HON: "XLI", UPS: "XLI", RTX: "XLI",
  LMT: "XLI", DE: "XLI",
  // Materials
  LIN: "XLB", APD: "XLB", SHW: "XLB", FCX: "XLB",
  // Utilities
  NEE: "XLU", DUK: "XLU", SO: "XLU",
  // Real Estate
  PLD: "XLRE", AMT: "XLRE", EQIX: "XLRE",
};

function getSectorETF(ticker: string): string {
  return TICKER_TO_SECTOR_ETF[ticker.toUpperCase()] || "OTHER";
}

// ── Yahoo Finance helper ─────────────────────────────────────────────────────
async function fetchYahooClose(ticker: string, range = "3mo"): Promise<number[] | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const json = await res.json();
    const closes: number[] = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    return closes.filter((v) => typeof v === "number" && !isNaN(v));
  } catch {
    return null;
  }
}

// Compute beta of stock vs SPY using daily returns
function computeBeta(stockCloses: number[], spyCloses: number[]): number {
  const n = Math.min(stockCloses.length, spyCloses.length);
  if (n < 30) return 1.0;
  const sR: number[] = [];
  const mR: number[] = [];
  for (let i = 1; i < n; i++) {
    sR.push((stockCloses[i] - stockCloses[i - 1]) / stockCloses[i - 1]);
    mR.push((spyCloses[i] - spyCloses[i - 1]) / spyCloses[i - 1]);
  }
  const meanS = sR.reduce((a, b) => a + b, 0) / sR.length;
  const meanM = mR.reduce((a, b) => a + b, 0) / mR.length;
  let cov = 0, varM = 0;
  for (let i = 0; i < sR.length; i++) {
    cov += (sR[i] - meanS) * (mR[i] - meanM);
    varM += (mR[i] - meanM) ** 2;
  }
  if (varM === 0) return 1.0;
  return cov / varM;
}

// ── Request schema ────────────────────────────────────────────────────────────
interface GateRequest {
  ticker: string;
  shares: number;
  entry_price: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body: GateRequest = await req.json();
    const ticker = (body.ticker || "").toUpperCase().trim();
    const shares = Number(body.shares);
    const entryPrice = Number(body.entry_price);

    if (!ticker || !/^[A-Z]{1,10}(-[A-Z]{2,4})?$/.test(ticker) || shares <= 0 || entryPrice <= 0) {
      return new Response(JSON.stringify({ error: "Invalid input" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load caps + open positions in parallel
    const [capsRes, positionsRes] = await Promise.all([
      supabase.from("portfolio_caps").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("virtual_positions").select("ticker, shares, entry_price, position_type").eq("user_id", userId).eq("status", "open"),
    ]);

    const caps = capsRes.data ?? {
      sector_max_pct: 35,
      portfolio_beta_max: 1.5,
      max_correlated_positions: 3,
      enforcement_mode: "warn",
      enabled: true,
    };

    const openPositions = positionsRes.data ?? [];

    if (!caps.enabled) {
      return new Response(JSON.stringify({
        ok: true, decision: "allow", caps, violations: [], metrics: { skipped: true }
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Fetch current prices for valuation ────────────────────────────────────
    const allTickers = Array.from(new Set([ticker, ...openPositions.map((p: any) => p.ticker.toUpperCase()), "SPY"]));
    const closesByTicker: Record<string, number[]> = {};
    await Promise.all(allTickers.map(async (t) => {
      const closes = await fetchYahooClose(t, "3mo");
      if (closes && closes.length > 0) closesByTicker[t] = closes;
    }));

    const spyCloses = closesByTicker["SPY"] || [];

    // Use latest close as current price; fallback to entry_price
    const priceFor = (t: string, fallback: number) => {
      const c = closesByTicker[t];
      return c && c.length > 0 ? c[c.length - 1] : fallback;
    };

    // ── Build position values & sector breakdown ──────────────────────────────
    const candidateValue = shares * entryPrice;
    const sectorTotals: Record<string, number> = {};
    const sectorTickers: Record<string, string[]> = {};
    let openValueTotal = 0;
    let weightedBetaSum = 0;

    for (const pos of openPositions) {
      const t = pos.ticker.toUpperCase();
      const px = priceFor(t, Number(pos.entry_price));
      const v = Number(pos.shares) * px;
      openValueTotal += v;
      const sec = getSectorETF(t);
      sectorTotals[sec] = (sectorTotals[sec] || 0) + v;
      sectorTickers[sec] = sectorTickers[sec] || [];
      if (!sectorTickers[sec].includes(t)) sectorTickers[sec].push(t);

      // Beta contribution
      const c = closesByTicker[t];
      const beta = c && spyCloses.length > 0 ? computeBeta(c, spyCloses) : 1.0;
      weightedBetaSum += beta * v;
    }

    // Add candidate
    const candidateSector = getSectorETF(ticker);
    sectorTotals[candidateSector] = (sectorTotals[candidateSector] || 0) + candidateValue;
    sectorTickers[candidateSector] = sectorTickers[candidateSector] || [];
    if (!sectorTickers[candidateSector].includes(ticker)) sectorTickers[candidateSector].push(ticker);

    const candidateBeta = (closesByTicker[ticker] && spyCloses.length > 0)
      ? computeBeta(closesByTicker[ticker], spyCloses)
      : 1.0;
    weightedBetaSum += candidateBeta * candidateValue;

    const newTotalValue = openValueTotal + candidateValue;
    const portfolioBeta = newTotalValue > 0 ? weightedBetaSum / newTotalValue : candidateBeta;
    const candidateSectorPct = newTotalValue > 0
      ? (sectorTotals[candidateSector] / newTotalValue) * 100
      : 100;
    const correlatedCount = (sectorTickers[candidateSector] || []).length;

    // ── Evaluate caps ─────────────────────────────────────────────────────────
    const violations: { code: string; message: string; value: number; cap: number }[] = [];

    if (candidateSectorPct > caps.sector_max_pct) {
      violations.push({
        code: "SECTOR_CONCENTRATION",
        message: `${candidateSector} would be ${candidateSectorPct.toFixed(1)}% of portfolio (cap ${caps.sector_max_pct}%)`,
        value: candidateSectorPct,
        cap: caps.sector_max_pct,
      });
    }

    if (portfolioBeta > caps.portfolio_beta_max) {
      violations.push({
        code: "BETA_LIMIT",
        message: `Portfolio beta would be ${portfolioBeta.toFixed(2)} (cap ${caps.portfolio_beta_max})`,
        value: portfolioBeta,
        cap: caps.portfolio_beta_max,
      });
    }

    if (correlatedCount > caps.max_correlated_positions) {
      violations.push({
        code: "CORRELATED_POSITIONS",
        message: `Would hold ${correlatedCount} positions in ${candidateSector} (cap ${caps.max_correlated_positions})`,
        value: correlatedCount,
        cap: caps.max_correlated_positions,
      });
    }

    const decision = violations.length === 0
      ? "allow"
      : caps.enforcement_mode === "block"
        ? "block"
        : "warn";

    return new Response(JSON.stringify({
      ok: true,
      decision,
      caps,
      violations,
      metrics: {
        candidate_sector: candidateSector,
        candidate_sector_pct: Number(candidateSectorPct.toFixed(2)),
        portfolio_beta: Number(portfolioBeta.toFixed(3)),
        correlated_count: correlatedCount,
        sector_breakdown: Object.fromEntries(
          Object.entries(sectorTotals).map(([k, v]) => [k, Number(((v / newTotalValue) * 100).toFixed(2))])
        ),
        new_total_value: Number(newTotalValue.toFixed(2)),
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("portfolio-gate error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
