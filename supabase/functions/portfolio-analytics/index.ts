// ============================================================================
// PORTFOLIO-ANALYTICS — whole-book view for the Portfolio page.
// User-scoped (JWT validated in code). Deterministic math, no AI calls.
// Returns weights, sectors, beta, correlation matrix, effective number of
// bets, per-position risk contribution and a ranked list of recommendations.
// Recommendations are advisory only — the autotrader still does the trading.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { loadCachedBars } from "../_shared/bars-cache.ts";
import { getSector } from "../_shared/finnhub.ts";
import { loadRiskParams, HARD_SECTOR_CAP_PCT, RISK_DEFAULTS } from "../_shared/adaptive-risk.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

function returns(c: number[], n = 61): number[] {
  const s = c.slice(-n);
  const o: number[] = [];
  for (let i = 1; i < s.length; i++) if (s[i - 1] > 0) o.push(s[i] / s[i - 1] - 1);
  return o;
}
function corr(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 20) return null;
  const x = a.slice(-n), y = b.slice(-n);
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let c = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { c += (x[i] - mx) * (y[i] - my); vx += (x[i] - mx) ** 2; vy += (y[i] - my) ** 2; }
  return vx > 0 && vy > 0 ? c / Math.sqrt(vx * vy) : null;
}
const sd = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing authorization" }, 401);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u, error: ue } = await sb.auth.getUser();
    if (ue || !u?.user) return json({ error: "Unauthorized" }, 401);
    const userId = u.user.id;

    const [{ data: pos }, { data: settings }] = await Promise.all([
      sb.from("virtual_positions").select("id, ticker, shares, entry_price, hard_stop_price, trailing_stop_price, position_type, created_at, entry_conviction")
        .eq("user_id", userId).eq("status", "open"),
      sb.from("autotrade_settings").select("starting_nav, risk_profile").eq("user_id", userId).maybeSingle(),
    ]);
    const open = (pos ?? []) as any[];
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const rp = settings?.risk_profile === "aggressive" ? await loadRiskParams(admin, userId) : { ...RISK_DEFAULTS };

    const tickers = [...new Set(open.map((p) => String(p.ticker).toUpperCase()))];
    const bars = await loadCachedBars([...tickers, "SPY"]);
    const spyR = returns(bars.get("SPY")?.close ?? []);

    // Realized cash from closed P&L
    const { data: closed } = await sb.from("virtual_positions").select("pnl").eq("user_id", userId).eq("status", "closed").limit(5000);
    const realized = (closed ?? []).reduce((s: number, r: any) => s + Number(r.pnl ?? 0), 0);
    const startNav = Number(settings?.starting_nav ?? 100000);

    const rows = await Promise.all(open.map(async (p) => {
      const t = String(p.ticker).toUpperCase();
      const close = bars.get(t)?.close ?? [];
      const last = close.length ? close[close.length - 1] : Number(p.entry_price);
      const r = returns(close);
      const shares = Number(p.shares);
      const sign = p.position_type === "short" ? -1 : 1;
      const value = shares * last;
      const stop = Number(p.trailing_stop_price ?? p.hard_stop_price ?? 0) || null;
      const riskToStop = stop ? Math.max(0, sign * (last - stop) * shares) : value * 0.08;
      const beta = (() => {
        const c = corr(r, spyR); const s1 = sd(r), s2 = sd(spyR);
        return c != null && s2 > 0 ? c * s1 / s2 : 1;
      })();
      let sector: string | null = null;
      try { sector = await getSector(t); } catch (_) { /* ignore */ }
      return {
        id: p.id, ticker: t, shares, entry: Number(p.entry_price), last, value, sign,
        pnl: sign * (last - Number(p.entry_price)) * shares,
        pnlPct: Number(p.entry_price) > 0 ? sign * (last / Number(p.entry_price) - 1) * 100 : 0,
        stop, stopDistPct: stop && last > 0 ? sign * (last - stop) / last * 100 : null,
        riskToStop, vol: sd(r), beta, sector: sector ?? "Other", r,
        ageDays: Math.floor((Date.now() - new Date(p.created_at).getTime()) / 864e5),
        conviction: p.entry_conviction ?? null,
      };
    }));

    const invested = rows.reduce((s, x) => s + x.value, 0);
    const costBasis = open.reduce((s, p) => s + Number(p.shares) * Number(p.entry_price), 0);
    const cash = startNav + realized - costBasis;
    const nav = cash + invested + 0; // value already includes unrealized
    const n = rows.length;

    // Correlation matrix + portfolio variance
    const C: (number | null)[][] = rows.map((a) => rows.map((b) => (a === b ? 1 : corr(a.r, b.r))));
    const w = rows.map((x) => (nav > 0 ? (x.sign * x.value) / nav : 0));
    const cov = (i: number, j: number) => (C[i][j] ?? 0.3) * rows[i].vol * rows[j].vol;
    let pVar = 0;
    const mrc = rows.map(() => 0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = w[i] * w[j] * cov(i, j); pVar += v; mrc[i] += v; }
    const pVolDaily = Math.sqrt(Math.max(0, pVar));
    const sumW2 = w.reduce((s, v) => s + v * v, 0);
    const effNames = sumW2 > 0 ? 1 / sumW2 : 0;
    // Correlation-adjusted bets: (Σ w σ)² / σ_p²
    const wsig = rows.reduce((s, x, i) => s + Math.abs(w[i]) * x.vol, 0);
    const effBets = pVar > 0 ? (wsig * wsig) / pVar : 0;
    const beta = rows.reduce((s, x, i) => s + w[i] * x.beta, 0);
    let avgCorr = 0, pairs = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (C[i][j] != null) { avgCorr += C[i][j]!; pairs++; }
    avgCorr = pairs ? avgCorr / pairs : 0;

    const sectors: Record<string, number> = {};
    rows.forEach((x) => { sectors[x.sector] = (sectors[x.sector] ?? 0) + (nav > 0 ? x.value / nav * 100 : 0); });
    const sectorCap = HARD_SECTOR_CAP_PCT;
    const heatPct = nav > 0 ? rows.reduce((s, x) => s + x.riskToStop, 0) / nav * 100 : 0;
    const varWeek95 = 1.645 * pVolDaily * Math.sqrt(5) * 100;

    // ── Recommendations ────────────────────────────────────────────────
    type Rec = { priority: number; kind: string; ticker?: string; title: string; reason: string };
    const recs: Rec[] = [];
    const capPct = rp.single_name_cap * 100;
    rows.forEach((x) => {
      const wt = nav > 0 ? x.value / nav * 100 : 0;
      if (wt > capPct + 2) recs.push({ priority: 90, kind: "trim", ticker: x.ticker,
        title: `Trim ${x.ticker} back to ${capPct.toFixed(0)}%`, reason: `It's ${wt.toFixed(1)}% of the account — one stock shouldn't carry that much.` });
      if (x.stopDistPct != null && x.stopDistPct < 1.5) recs.push({ priority: 85, kind: "stop", ticker: x.ticker,
        title: `Review ${x.ticker} — ${x.stopDistPct.toFixed(1)}% from its stop`, reason: "Close to its exit line; decide before it decides for you." });
      if (x.ageDays > 30 && Math.abs(x.pnlPct) < 2) recs.push({ priority: 50, kind: "rotate", ticker: x.ticker,
        title: `Rotate out of ${x.ticker}`, reason: `Held ${x.ageDays} days with ${x.pnlPct.toFixed(1)}% — that money could be working elsewhere.` });
    });
    Object.entries(sectors).forEach(([s, pct]) => {
      if (pct > sectorCap) recs.push({ priority: 80, kind: "sector", title: `Reduce ${s} to under ${sectorCap}%`, reason: `${s} is ${pct.toFixed(0)}% of the account.` });
    });
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const c = C[i][j];
      if (c != null && c > 0.8) recs.push({ priority: 60, kind: "overlap",
        title: `${rows[i].ticker} and ${rows[j].ticker} move together`, reason: `Correlation ${c.toFixed(2)} — effectively one bet held twice.` });
    }
    const cashPct = nav > 0 ? cash / nav * 100 : 100;
    if (cashPct > 25) recs.push({ priority: 70, kind: "deploy", title: `Put idle cash to work (${cashPct.toFixed(0)}% in cash)`,
      reason: `Target is ~${rp.target_positions} holdings; you hold ${n}. Smaller positions across more names lowers risk per dollar.` });
    const covered = new Set(Object.keys(sectors));
    const majors = ["Technology", "Healthcare", "Financials", "Industrials", "Consumer Discretionary", "Consumer Staples", "Energy", "Communication Services", "Utilities", "Materials", "Real Estate"];
    const missing = majors.filter((s) => !covered.has(s));
    if (missing.length >= 4) recs.push({ priority: 55, kind: "diversify", title: `Add exposure to ${missing.slice(0, 3).join(", ")}`,
      reason: `${missing.length} major sectors have no holdings — the book leans on a few themes.` });
    if (beta > 1.4) recs.push({ priority: 65, kind: "beta", title: `Market sensitivity is high (beta ${beta.toFixed(2)})`,
      reason: "A 5% market drop would cost roughly " + (beta * 5).toFixed(1) + "% of invested money. Favor steadier names next." });
    recs.sort((a, b) => b.priority - a.priority);

    return json({
      nav, cash, invested, startNav, realized, n,
      metrics: { beta, effNames, effBets, avgCorr, heatPct, varWeek95, volAnnualPct: pVolDaily * Math.sqrt(252) * 100, cashPct, targetPositions: rp.target_positions, sectorCap, singleCapPct: capPct },
      sectors: Object.entries(sectors).map(([sector, pct]) => ({ sector, pct })).sort((a, b) => b.pct - a.pct),
      holdings: rows.map((x, i) => ({
        id: x.id, ticker: x.ticker, sector: x.sector, shares: x.shares, entry: x.entry, last: x.last, value: x.value,
        weightPct: nav > 0 ? x.value / nav * 100 : 0, pnl: x.pnl, pnlPct: x.pnlPct, stopDistPct: x.stopDistPct,
        beta: x.beta, riskSharePct: pVar > 0 ? mrc[i] / pVar * 100 : 0, ageDays: x.ageDays,
      })),
      correlation: { tickers: rows.map((x) => x.ticker), matrix: C },
      recommendations: recs.slice(0, 10),
      asOf: new Date().toISOString(),
    });
  } catch (e) {
    console.error("portfolio-analytics", e);
    return json({ error: "Could not build portfolio view" }, 500);
  }
});
