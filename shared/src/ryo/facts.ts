import type { EvidenceBook, EvidenceId, RyoEvidence } from "./evidence";
import { readPath } from "./evidence";

/**
 * Normalised facts the decision rules use. Each one is either a value with the evidence id and payload path it was
 * read from, or missing with a reason. A fact read from partial, unavailable or simulated evidence is missing.
 */
export type Fact<T> =
  | { ok: true; value: T; evidence: EvidenceId; path: string }
  | { ok: false; reason: string; evidence?: EvidenceId };

export const missing = <T>(reason: string, evidence?: EvidenceId): Fact<T> => ({ ok: false, reason, evidence });

export type MarketRisk = "low" | "medium" | "high";
export type WavePhase = "early" | "mid" | "late";
export type Direction = "up" | "down" | "flat";

export type MarketFacts = {
  risk: Fact<MarketRisk>;
  /** Fired by a sentiment-shift monitor; "none" when no shift. */
  shift: Fact<"none" | "bullish" | "bearish">;
};

export type TokenFacts = {
  token: string;
  inCatalog: Fact<boolean>;
  price: Fact<number>;
  change24hPct: Fact<number>;
  direction: Fact<Direction>;
  phase: Fact<WavePhase>;
  safety: Fact<"pass" | "warn" | "fail">;
  /** Token performance minus BTC over the comparison window, in percentage points. */
  vsBtcPct: Fact<number>;
  /** Token performance minus a peer in the same sector, in percentage points. */
  vsPeerPct: Fact<number>;
  peer: string | null;
  /** ATR(14) in price units, when RYO supplies it; used for the stop distance. */
  atr?: Fact<number>;
  /** Risks RYO lists for the token, verbatim, for display. */
  risks?: string[];
};

/** Reads one fact from one piece of evidence, refusing anything that is not live. */
export function factFrom<T>(
  evidence: RyoEvidence | undefined,
  path: string,
  convert: (raw: unknown) => T | undefined,
  label: string,
): Fact<T> {
  if (!evidence) return missing(`${label}: no RYO evidence`);
  if (evidence.status !== "live") return missing(`${label}: ${evidence.id} is ${evidence.status}${evidence.statusReason ? ` (${evidence.statusReason})` : ""}`, evidence.id);
  const raw = readPath(evidence.payload, path);
  const value = convert(raw);
  if (value === undefined) return missing(`${label}: ${evidence.id}.${path} is absent or unreadable`, evidence.id);
  return { ok: true, value, evidence: evidence.id, path };
}

export const asNumber = (raw: unknown) => {
  const n = typeof raw === "string" ? Number(raw.replace(/[,%$\s]/g, "")) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(n) ? n : undefined;
};

export const citeOf = (fact: Fact<unknown>) => (fact.ok ? [fact.evidence] : fact.evidence ? [fact.evidence] : []);

export type FactsBundle = { market: MarketFacts; token: TokenFacts; book: EvidenceBook };
