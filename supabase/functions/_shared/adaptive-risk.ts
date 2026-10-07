// ============================================================================
// ADAPTIVE RISK PARAMS — single source of truth for every Aggressive-mode
// number. Nightly `tune-risk-params` learns a per-user value for each key from
// recent results + market mood; the live autotrader reads it via
// resolveRiskParams(). Every value is clamped to a HARD WALL it can never
// cross, and moves at most MAX_STEP per night. Cold start = DEFAULTS.
// ============================================================================

export interface RiskParams {
  min_entry_frac: number;
  top_entry_frac: number;
  single_name_cap: number;
  heat_cap_pct: number;
  cvar_cap_pct: number;
  min_conviction: number;
  tp_ceiling_pct: number;
  haircut_corr: number;
  haircut_atr: number;
  haircut_dd: number;
  haircut_floor: number;
  dd_brake_pct: number;
}

export const RISK_DEFAULTS: RiskParams = {
  min_entry_frac: 0.08,
  top_entry_frac: 0.12,
  single_name_cap: 0.15,
  heat_cap_pct: 10,
  cvar_cap_pct: 4,
  min_conviction: 62,
  tp_ceiling_pct: 25,
  haircut_corr: 0.8,
  haircut_atr: 0.75,
  haircut_dd: 0.5,
  haircut_floor: 0.6,
  dd_brake_pct: 12,
};

/** Hard walls — never adaptive. */
export const RISK_WALLS: Record<keyof RiskParams, [number, number]> = {
  min_entry_frac: [0.03, 0.12],
  top_entry_frac: [0.05, 0.18],
  single_name_cap: [0.05, 0.20],
  heat_cap_pct: [4, 14],
  cvar_cap_pct: [1.5, 6],
  min_conviction: [55, 80],
  tp_ceiling_pct: [12, 30],
  haircut_corr: [0.5, 1],
  haircut_atr: [0.5, 1],
  haircut_dd: [0.3, 0.7],
  haircut_floor: [0.4, 0.9],
  dd_brake_pct: [8, 15],
};

/** Largest change allowed in one night, per key. */
export const MAX_STEP: Record<keyof RiskParams, number> = {
  min_entry_frac: 0.01, top_entry_frac: 0.015, single_name_cap: 0.015,
  heat_cap_pct: 1, cvar_cap_pct: 0.5, min_conviction: 2, tp_ceiling_pct: 2,
  haircut_corr: 0.05, haircut_atr: 0.05, haircut_dd: 0.05, haircut_floor: 0.05,
  dd_brake_pct: 1,
};

export const MIN_SAMPLES = 20;

export function clampWall(k: keyof RiskParams, v: number): number {
  const [lo, hi] = RISK_WALLS[k];
  return Math.max(lo, Math.min(hi, v));
}

export function stepToward(k: keyof RiskParams, prev: number, target: number): number {
  const s = MAX_STEP[k];
  return clampWall(k, prev + Math.max(-s, Math.min(s, target - prev)));
}

export function sanitize(raw: Partial<RiskParams> | null | undefined): RiskParams {
  const out = { ...RISK_DEFAULTS };
  for (const k of Object.keys(RISK_DEFAULTS) as Array<keyof RiskParams>) {
    const v = raw?.[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = clampWall(k, v);
  }
  return out;
}

export interface TuneInputs {
  closedPnlPct: number[]; // per-trade fractions, e.g. 0.05
  winnerMfePct: number[]; // max favourable excursion of winners, percent
  lowConvPnlPct: number[]; // trades with conviction < current floor+5
  vixRegime: string | null; // calm | normal | elevated | crisis
  drawdownPct: number;
  corrFlaggedPnl: number[]; // outcomes of trades that hit the corr haircut
  atrFlaggedPnl: number[];
}

/** Pure nightly tuner. Returns the new params and human reasons. */
export function tuneRiskParams(prev: RiskParams, x: TuneInputs): { params: RiskParams; reasons: string[] } {
  const reasons: string[] = [];
  const n = x.closedPnlPct.length;
  if (n < MIN_SAMPLES) {
    return { params: prev, reasons: [`only ${n} closed trades (<${MIN_SAMPLES}) — holding values`] };
  }
  const mean = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  const wr = x.closedPnlPct.filter((v) => v > 0).length / n;
  const exp = mean(x.closedPnlPct);
  // perf score in [-1, 1]
  const perf = Math.max(-1, Math.min(1, (wr - 0.5) * 4 + exp * 20));
  const mood = x.vixRegime === "calm" ? 1 : x.vixRegime === "elevated" ? -0.5 : x.vixRegime === "crisis" ? -1 : 0;
  const z = Math.max(-1, Math.min(1, 0.6 * perf + 0.4 * mood));
  reasons.push(`winRate=${(wr * 100).toFixed(0)}% exp=${(exp * 100).toFixed(2)}% vix=${x.vixRegime ?? "?"} → score ${z.toFixed(2)}`);

  const t: RiskParams = { ...prev };
  const scale = (k: keyof RiskParams, base: number, spread: number) =>
    (t[k] = stepToward(k, prev[k], base * (1 + spread * z)));
  scale("min_entry_frac", RISK_DEFAULTS.min_entry_frac, 0.4);
  scale("top_entry_frac", RISK_DEFAULTS.top_entry_frac, 0.4);
  scale("single_name_cap", RISK_DEFAULTS.single_name_cap, 0.3);
  scale("heat_cap_pct", RISK_DEFAULTS.heat_cap_pct, 0.3);
  scale("cvar_cap_pct", RISK_DEFAULTS.cvar_cap_pct, 0.3);

  // Conviction floor: stressed market raises it; profitable low-score picks lower it.
  const lowExp = x.lowConvPnlPct.length >= 8 ? mean(x.lowConvPnlPct) : null;
  let convTarget = RISK_DEFAULTS.min_conviction - 4 * mood;
  if (lowExp !== null) convTarget += lowExp > 0 ? -3 : 3;
  t.min_conviction = Math.round(stepToward("min_conviction", prev.min_conviction, convTarget));

  // TP ceiling follows the 80th pct of winner MFE.
  if (x.winnerMfePct.length >= 8) {
    const s = [...x.winnerMfePct].sort((a, b) => a - b);
    const p80 = s[Math.floor(s.length * 0.8)];
    t.tp_ceiling_pct = stepToward("tp_ceiling_pct", prev.tp_ceiling_pct, p80 * 1.1);
    reasons.push(`winner MFE p80=${p80.toFixed(1)}%`);
  }

  // Haircuts: if flagged trades lost, cut harder; if they won, soften.
  const hc = (k: "haircut_corr" | "haircut_atr", arr: number[]) => {
    if (arr.length < 6) return;
    const m = mean(arr);
    t[k] = stepToward(k, prev[k], prev[k] + (m > 0 ? 0.05 : -0.05));
    reasons.push(`${k} flagged exp=${(m * 100).toFixed(2)}%`);
  };
  hc("haircut_corr", x.corrFlaggedPnl);
  hc("haircut_atr", x.atrFlaggedPnl);

  t.haircut_dd = stepToward("haircut_dd", prev.haircut_dd, RISK_DEFAULTS.haircut_dd + 0.1 * z);
  t.haircut_floor = stepToward("haircut_floor", prev.haircut_floor, RISK_DEFAULTS.haircut_floor + 0.1 * z);
  t.dd_brake_pct = stepToward("dd_brake_pct", prev.dd_brake_pct, RISK_DEFAULTS.dd_brake_pct + 2 * z);
  return { params: t, reasons };
}

/** Per-trade modulation: higher conviction → slightly larger entry floor. */
export function entryFloorFor(p: RiskParams, conviction: number): number {
  if (conviction >= 85) return p.top_entry_frac;
  const t = Math.max(0, Math.min(1, (conviction - p.min_conviction) / Math.max(1, 85 - p.min_conviction)));
  return clampWall("min_entry_frac", p.min_entry_frac * (0.85 + 0.3 * t));
}

export async function loadRiskParams(supabase: any, userId: string): Promise<RiskParams> {
  try {
    const { data } = await supabase.from("adaptive_risk_params")
      .select("params").eq("user_id", userId).maybeSingle();
    return sanitize(data?.params);
  } catch (_) {
    return { ...RISK_DEFAULTS };
  }
}

export function summarize(p: RiskParams): string {
  return `size${(p.min_entry_frac * 100).toFixed(1)}/${(p.top_entry_frac * 100).toFixed(1)}% cap${(p.single_name_cap * 100).toFixed(0)}% heat${p.heat_cap_pct.toFixed(1)} cvar${p.cvar_cap_pct.toFixed(1)} tp${p.tp_ceiling_pct.toFixed(0)}`;
}
