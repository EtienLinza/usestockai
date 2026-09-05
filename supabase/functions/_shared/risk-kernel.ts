// ============================================================================
// RISK KERNEL — final portfolio authority for shadow, paper, and live modes.
//
// SINGLE SOURCE OF TRUTH for "may this candidate take capital right now".
// Every veto returns a named reason so the log page can answer "why did we not
// trade today" from data instead of guesswork. Pure — no IO, no clock unless
// injected.
// ============================================================================
import type { PortfolioCandidate, RiskDecision, RiskLimits } from "./quant-contracts.ts";

export interface PortfolioRiskState {
  navDollars: number;
  grossExposurePct: number;
  netExposurePct: number;
  /** Existing exposure in THIS candidate's ticker. */
  singleNameExposurePct: number;
  /** Existing exposure in THIS candidate's sector. */
  sectorExposurePct: number;
  portfolioRiskPct: number;
  dailyPnlPct: number;
  /** Pending same-sector exposure already approved earlier in this scan. */
  candidateSectorExposurePct: number;
  staleDataMinutes: number;
  currentShortExposurePct: number;
  candidateShortExposurePct: number;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export const RISK_KERNEL_VERSION = "risk-kernel-v1";

export function evaluateCandidateRisk(
  candidate: PortfolioCandidate,
  state: PortfolioRiskState,
  limits: RiskLimits,
  now = new Date().toISOString(),
): RiskDecision {
  const reasons: string[] = [];
  const nav = finite(state.navDollars, 0);
  const proposed = Math.max(0, finite(candidate.proposedNotionalDollars, 0));
  const proposedPct = nav > 0 ? (proposed / nav) * 100 : 0;
  const proposedRisk = Math.max(0, finite(candidate.riskContributionPct, 0));
  const maxParticipation = Math.max(0, finite(limits.maxParticipationPct, 0));

  if (nav <= 0) reasons.push("nav_invalid");
  if (candidate.signal.side === "short" && !limits.allowShorts) reasons.push("shorts_disabled");
  if (finite(candidate.uncertaintyScore, 1) > 0.85) reasons.push("uncertainty_too_high");
  if (finite(candidate.liquidityScore, 0) < 0.25) reasons.push("liquidity_too_low");
  if (finite(candidate.economics.estimatedParticipationPct, Infinity) > maxParticipation) reasons.push("participation_limit");
  if (finite(candidate.economics.expectedNetEdgePct, -Infinity) <= 0) reasons.push("negative_net_edge");
  if (state.staleDataMinutes > Math.max(0, limits.maxStaleDataMinutes)) reasons.push("stale_data");
  if (state.dailyPnlPct <= -Math.abs(limits.maxDailyLossPct)) reasons.push("daily_loss_limit");
  if (state.grossExposurePct + proposedPct > limits.maxGrossExposurePct) reasons.push("gross_exposure_limit");
  if (Math.abs(state.netExposurePct + (candidate.signal.side === "long" ? proposedPct : -proposedPct)) > limits.maxNetExposurePct) reasons.push("net_exposure_limit");
  if (state.singleNameExposurePct + proposedPct > limits.maxSingleNamePct) reasons.push("single_name_limit");
  if (state.sectorExposurePct + state.candidateSectorExposurePct + proposedPct > limits.maxSectorPct) reasons.push("sector_limit");
  if (state.portfolioRiskPct + proposedRisk > limits.maxPortfolioRiskPct) reasons.push("portfolio_risk_limit");
  if (
    candidate.signal.side === "short" &&
    state.currentShortExposurePct + state.candidateShortExposurePct + proposedPct > limits.maxNetExposurePct
  ) reasons.push("short_exposure_limit");

  const allowed = reasons.length === 0;
  return {
    allowed,
    approvedNotionalDollars: allowed ? proposed : 0,
    approvedRiskPct: allowed ? proposedRisk : 0,
    reasons,
    evaluatedAt: now,
    limitsVersion: RISK_KERNEL_VERSION,
  };
}
