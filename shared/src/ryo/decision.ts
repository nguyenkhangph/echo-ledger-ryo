import type { Hex } from "viem";
import { cardHash } from "../hash";
import { independentScore, naiveScore, type VoteSource } from "../echo";
import { citeOf, type Fact, type MarketFacts, type TokenFacts } from "./facts";
import type { EvidenceId } from "./evidence";

/**
 * Echo Ledger × RYO-CHAN decision rules. Pure and deterministic: the same voices and the same RYO evidence always give
 * the same decision and the same hash. Every number in a trade plan is computed here from RYO's live price; no
 * language model writes a level.
 */

export const BASE_THRESHOLD = 0.6;
export const TIGHT_THRESHOLD = 0.67;
export const MIN_INDEPENDENT = 2;
export const MAX_SIZE_BPS = 500;
export const BASE_SIZE_BPS = 250;
export const MIN_STOP_PCT = 2;
export const MAX_STOP_PCT = 8;
export const REWARD_RISK = 2;
export const HORIZON_H = 24;

export type Voice = VoteSource & { posted_at?: string };

export type DecisionOptions = {
  /** Counterfactual: count reposts as voices, like a naive bot. */
  countEchoes?: boolean;
  /** Counterfactual: drop one source entirely. */
  dropHandle?: string | null;
  /** Counterfactual: ignore RYO's vetoes (market risk, safety, basket, timing, contradiction). */
  ignoreRyoVetoes?: boolean;
};

export type Verdict = "OPEN" | "REJECT" | "NOT_ANALYZABLE" | "INSUFFICIENT_EVIDENCE";

export type Gate = {
  id: string;
  label: string;
  passed: boolean;
  /** Vetoes come from RYO data; the counterfactual "ignore RYO vetoes" turns them off. */
  ryoVeto: boolean;
  detail: string;
  evidence: EvidenceId[];
};

export type VoiceCheck = { handle: string; sentiment: Voice["sentiment"]; echo: boolean; ryo: "corroborated" | "unconfirmed" | "contradicted"; note: string };

export type TradePlan = {
  side: "LONG" | "SHORT";
  entry: number;
  stop: number;
  target: number;
  stopPct: number;
  sizeBps: number;
  horizonH: number;
  priceEvidence: EvidenceId;
};

/** Plain-language reason for each failed gate, used in headlines. */
const WHY: Record<string, string> = {
  independence: "not enough independent agreement",
  market: "RYO rates market risk high",
  shift: "RYO's sentiment monitor is turning against the call",
  agreement: "RYO's data does not back the direction",
  safety: "RYO lists a severe risk",
  timing: "the call comes late in the move",
  basket: "the token does not beat its basket",
  crosscheck: "two RYO tools disagree about the token",
};

/** Two RYO price readings further apart than this (percent) are treated as inconsistent data. */
export const CROSS_PRICE_TOLERANCE_PCT = 1;

export type Decision = {
  token: string;
  verdict: Verdict;
  side: "LONG" | "SHORT" | "NONE";
  headline: string;
  score: number;
  threshold: number;
  independent: number;
  agreeing: number;
  gates: Gate[];
  voices: VoiceCheck[];
  plan: TradePlan | null;
  missing: string[];
  options: Required<DecisionOptions>;
  hash: Hex;
};

export type DecisionInput = { token: string; voices: Voice[]; market: MarketFacts; facts: TokenFacts };

const round = (v: number, digits: number) => Number(v.toFixed(digits));
const priceDigits = (p: number) => (p >= 1000 ? 2 : p >= 1 ? 4 : 8);

function gate(id: string, label: string, passed: boolean, detail: string, facts: Fact<unknown>[], ryoVeto = true): Gate {
  return { id, label, passed, ryoVeto, detail, evidence: [...new Set(facts.flatMap(citeOf))] };
}

/** Practice levels from RYO's live price: stop scales with the 24 h move inside 2–8%, target at 2R. */
export function tradePlan(side: "LONG" | "SHORT", price: Fact<number>, change24h: Fact<number>, score: number, atr?: Fact<number>): TradePlan | null {
  if (!price.ok || price.value <= 0) return null;
  // Stop = 1.5 × ATR(14) when RYO gives it, else 0.75 × the 24 h move; always clamped to 2–8%.
  const raw = atr?.ok && atr.value > 0 ? (1.5 * atr.value * 100) / price.value : change24h.ok ? Math.abs(change24h.value) * 0.75 : MAX_STOP_PCT;
  const stopPct = round(Math.min(MAX_STOP_PCT, Math.max(MIN_STOP_PCT, raw)), 2);
  const d = priceDigits(price.value);
  const entry = round(price.value, d);
  const stop = round(side === "LONG" ? entry * (1 - stopPct / 100) : entry * (1 + stopPct / 100), d);
  const target = round(side === "LONG" ? entry + REWARD_RISK * (entry - stop) : entry - REWARD_RISK * (stop - entry), d);
  const sizeBps = Math.min(MAX_SIZE_BPS, Math.round((BASE_SIZE_BPS * (score / BASE_THRESHOLD)) / 25) * 25);
  return { side, entry, stop, target, stopPct, sizeBps, horizonH: HORIZON_H, priceEvidence: price.evidence };
}

export function decide(input: DecisionInput, options: DecisionOptions = {}): Decision {
  const opts: Required<DecisionOptions> = { countEchoes: options.countEchoes ?? false, dropHandle: options.dropHandle ?? null, ignoreRyoVetoes: options.ignoreRyoVetoes ?? false };
  const { market, facts } = input;
  const voices = input.voices.filter((v) => v.handle !== opts.dropHandle);
  const scored = opts.countEchoes ? naiveScore(voices) : independentScore(voices);
  const side = scored.side === "bullish" ? "LONG" : scored.side === "bearish" ? "SHORT" : "NONE";
  const ryoDir = facts.direction.ok ? facts.direction.value : null;
  const wants = side === "LONG" ? "up" : side === "SHORT" ? "down" : null;

  // KOL words are claims; RYO decides whether they are backed.
  const voiceChecks: VoiceCheck[] = voices.map((v) => {
    const vDir = v.sentiment === "bullish" ? "up" : v.sentiment === "bearish" ? "down" : null;
    const ryo: VoiceCheck["ryo"] = !ryoDir || !vDir || ryoDir === "flat" ? "unconfirmed" : ryoDir === vDir ? "corroborated" : "contradicted";
    const note =
      ryo === "corroborated" ? "RYO's live data points the same way" : ryo === "contradicted" ? "RYO's live data points the other way" : "not confirmed by RYO; not a buy signal";
    return { handle: v.handle, sentiment: v.sentiment, echo: v.is_echo, ryo, note };
  });

  const missingFacts: string[] = [];
  const need = (_label: string, f: Fact<unknown>) => {
    if (!f.ok) missingFacts.push(f.reason);
  };

  const base = { token: input.token.toUpperCase(), side: "NONE" as const, score: scored.score, independent: scored.voices, agreeing: scored.agreeing, voices: voiceChecks, plan: null, options: opts };
  const finish = (d: Omit<Decision, "hash">): Decision => ({ ...d, hash: cardHash({ input, decision: d }) });

  // 1. Catalog: a token RYO does not cover is not analysed, and nothing is invented for it.
  if (!facts.inCatalog.ok || !facts.inCatalog.value) {
    const reason = facts.inCatalog.ok ? `${base.token} is not in RYO-CHAN's catalog` : facts.inCatalog.reason;
    return finish({ ...base, verdict: "NOT_ANALYZABLE", headline: `${base.token}: not analysed. ${reason}.`, threshold: BASE_THRESHOLD, gates: [gate("catalog", "Token covered by RYO", false, reason, [facts.inCatalog])], missing: [reason] });
  }

  // 2. Threshold moves with the market: a tense market needs a stronger independent majority.
  need("market risk", market.risk);
  const risk = market.risk.ok ? market.risk.value : null;
  const threshold = risk === "medium" ? TIGHT_THRESHOLD : BASE_THRESHOLD;

  const gates: Gate[] = [];
  gates.push(
    gate(
      "independence",
      opts.countEchoes ? "Agreement (counting every post)" : "Independent agreement",
      scored.voices >= MIN_INDEPENDENT && scored.score >= threshold && side !== "NONE",
      `${scored.agreeing} of ${scored.voices} ${opts.countEchoes ? "posts" : "independent voices"} agree (${scored.score.toFixed(2)}); needs ≥ ${threshold.toFixed(2)} and ≥ ${MIN_INDEPENDENT} voices${risk === "medium" ? " (raised: market risk medium)" : ""}`,
      [market.risk],
      false,
    ),
  );

  need("price", facts.price);
  need("24h change", facts.change24hPct);
  need("direction", facts.direction);
  gates.push(gate("market", "Market risk acceptable", risk !== "high", risk ? `RYO market overview: risk ${risk}` : "market overview missing", [market.risk]));
  if (market.shift.ok && market.shift.value !== "none")
    gates.push(
      gate("shift", "No sentiment reversal against the call", !((market.shift.value === "bearish" && side === "LONG") || (market.shift.value === "bullish" && side === "SHORT")), `RYO sentiment-shift monitor: ${market.shift.value}`, [market.shift]),
    );
  gates.push(
    gate(
      "agreement",
      "RYO supports the KOL direction",
      !!ryoDir && !!wants && ryoDir === wants,
      ryoDir ? `RYO direction ${ryoDir}; KOLs say ${wants ?? "nothing tradable"}` : "RYO direction missing",
      [facts.direction],
    ),
  );
  // Cross-check: deep_analysis and analyze_token must tell the same story when both answered.
  const cx = facts.cross;
  if (cx && ((cx.deepDirection.ok && cx.quickDirection.ok) || (cx.deepPrice.ok && cx.quickPrice.ok))) {
    const dirOk = !(cx.deepDirection.ok && cx.quickDirection.ok) || cx.deepDirection.value === cx.quickDirection.value;
    const gapPct = cx.deepPrice.ok && cx.quickPrice.ok ? (Math.abs(cx.deepPrice.value - cx.quickPrice.value) / cx.deepPrice.value) * 100 : null;
    const priceOk = gapPct === null || gapPct <= CROSS_PRICE_TOLERANCE_PCT;
    const parts = [
      cx.deepDirection.ok && cx.quickDirection.ok ? `direction ${cx.deepDirection.value} vs ${cx.quickDirection.value}` : null,
      gapPct !== null ? `price gap ${gapPct.toFixed(2)}% (max ${CROSS_PRICE_TOLERANCE_PCT}%)` : null,
    ].filter(Boolean);
    gates.push(gate("crosscheck", "deep_analysis and analyze_token agree", dirOk && priceOk, parts.join(" · "), [cx.deepDirection, cx.quickDirection, cx.deepPrice, cx.quickPrice]));
  }
  if (facts.safety.ok || facts.safety.evidence)
    gates.push(gate("safety", "Token safety check", facts.safety.ok && facts.safety.value !== "fail", facts.safety.ok ? `RYO safety: ${facts.safety.value}` : facts.safety.reason, [facts.safety]));
  gates.push(
    gate(
      "timing",
      "Call is not late to the move",
      facts.phase.ok ? facts.phase.value !== "late" : false,
      facts.phase.ok ? `RYO places the move at the ${facts.phase.value} stage` : facts.phase.reason,
      [facts.phase],
    ),
  );
  const strength = side === "SHORT" ? -1 : 1;
  const basketOk = facts.vsBtcPct.ok && facts.vsBtcPct.value * strength >= 0 && (!facts.vsPeerPct.ok || facts.vsPeerPct.value * strength >= 0);
  gates.push(
    gate(
      "basket",
      side === "SHORT" ? "Weaker than its basket" : "Stronger than its basket",
      basketOk,
      facts.vsBtcPct.ok
        ? `vs BTC ${facts.vsBtcPct.value >= 0 ? "+" : ""}${facts.vsBtcPct.value.toFixed(2)} pts${facts.vsPeerPct.ok ? `, vs ${facts.peer ?? "peer"} ${facts.vsPeerPct.value >= 0 ? "+" : ""}${facts.vsPeerPct.value.toFixed(2)} pts` : ""}`
        : facts.vsBtcPct.reason,
      [facts.vsBtcPct, facts.vsPeerPct],
    ),
  );

  const counted = gates.filter((g) => !(opts.ignoreRyoVetoes && g.ryoVeto));
  const failed = counted.filter((g) => !g.passed);
  const priceKnown = facts.price.ok;

  if (!priceKnown || !market.risk.ok || !facts.direction.ok) {
    return finish({ ...base, verdict: "INSUFFICIENT_EVIDENCE", headline: `${base.token}: not decided. Live RYO data is missing: ${missingFacts.join("; ")}.`, threshold, gates, missing: missingFacts });
  }
  if (failed.length > 0 || side === "NONE") {
    const contradiction = gates.find((g) => g.id === "agreement" && !g.passed && !opts.ignoreRyoVetoes);
    const headline = contradiction && side !== "NONE"
      ? `${base.token}: rejected in public. KOLs call ${side === "LONG" ? "up" : "down"}, RYO's live data does not support it.`
      : `${base.token}: rejected, ${failed.map((g) => WHY[g.id] ?? g.label.toLowerCase()).join("; ") || "no tradable direction"}.`;
    return finish({ ...base, verdict: "REJECT", headline, threshold, gates, missing: missingFacts });
  }
  const plan = tradePlan(side, facts.price, facts.change24hPct, scored.score, facts.atr);
  return finish({
    ...base,
    verdict: "OPEN",
    side,
    plan,
    headline: `${base.token}: practice ${side.toLowerCase()} opened at ${plan!.entry}, stop ${plan!.stop}, target ${plan!.target}.`,
    threshold,
    gates,
    missing: missingFacts,
  });
}

/** Before and after for each counterfactual the dashboard offers. */
export function counterfactuals(input: DecisionInput) {
  const actual = decide(input);
  const handles = [...new Set(input.voices.map((v) => v.handle))];
  return {
    actual,
    // The naive bot counts every post and has no RYO check at all.
    naive: decide(input, { countEchoes: true, ignoreRyoVetoes: true }),
    withoutRyoVetoes: decide(input, { ignoreRyoVetoes: true }),
    withoutEach: handles.map((h) => ({ handle: h, decision: decide(input, { dropHandle: h }) })),
  };
}
