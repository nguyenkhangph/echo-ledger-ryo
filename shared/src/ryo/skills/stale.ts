import { tokenFacts } from "../adapter";
import type { RyoEvidence } from "../evidence";
import { envelope, statusFrom, type Availability, type SkillDefinition, type SkillEnvelope } from "./envelope";

/**
 * Skill `stale_call`. A KOL call has a shelf life. This skill measures how stale a call is against RYO's live state
 * of the token (analyze_token or deep_analysis), with three published components:
 *
 *   age    hours since the post: 0 at ≤ 2 h, rising linearly to 100 at 48 h            (weight 0.40)
 *   move   how much of a normal day's range (1.5 × ATR%, or 5% without ATR) the price has
 *          already travelled in the call's direction over 24 h: 0 → 100                  (weight 0.35)
 *   phase  RSI(14) read in the call's direction: 50 → 0, 80 → 100                         (weight 0.25)
 *
 * The score averages the components that are available (weights renormalised). fresh < 35 ≤ aging < 65 ≤ stale.
 * If the price already moved against the call by more than half a day's range, the label is "invalidated".
 * A component RYO did not supply is null and listed in availability; it is never filled with a guess.
 */
export const STALE_TOOL = "stale_call";

export type StaleArgs = { symbol: string; side: "long" | "short"; posted_at: string; as_of?: string };
export type StaleLabel = "fresh" | "aging" | "stale" | "invalidated";
export type StaleData = {
  symbol: string;
  side: "long" | "short";
  age_h: number;
  components: { age: number; move: number | null; phase: number | null };
  inputs: { change_24h_pct: number | null; atr_pct: number | null; rsi_14: number | null; ryo_evidence: string | null; ryo_paths: string[] };
  score: number;
  label: StaleLabel;
  reasons: string[];
};

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const r1 = (x: number) => Math.round(x * 10) / 10;

export function staleCall(args: StaleArgs, ryo?: RyoEvidence): SkillEnvelope<StaleData> {
  const asOf = args.as_of ?? ryo?.fetchedAt ?? new Date().toISOString();
  const request = { symbol: args.symbol, side: args.side, posted_at: args.posted_at };
  const symbol = String(args.symbol ?? "").trim().toUpperCase();
  const posted = Date.parse(args.posted_at ?? "");
  const side = args.side === "short" ? "short" : args.side === "long" ? "long" : null;
  if (!symbol || !side || !Number.isFinite(posted)) {
    return envelope<StaleData>({
      tool: STALE_TOOL, status: "unavailable", data_mode: "unknown", as_of: asOf, request, data: null,
      summary: { headline: "Cannot measure staleness: symbol, side (long|short) and a valid posted_at are required.", key_points: [] },
      availability: { age: "unavailable", market_state: "unavailable" }, warnings: ["invalid arguments"],
    });
  }

  const ageH = Math.max(0, (Date.parse(asOf) - posted) / 3_600_000);
  const age = r1(clamp((ageH - 2) / 46) * 100);
  const f = ryo ? tokenFacts(symbol, ryo, undefined, null, side === "short" ? "SHORT" : "LONG") : null;
  const dir = side === "short" ? -1 : 1;
  const change = f?.change24hPct.ok ? f.change24hPct.value : null;
  const atrPct = f?.atr?.ok && f.price.ok ? (f.atr.value / f.price.value) * 100 : null;
  const rsi = f?.rsi?.ok ? f.rsi.value : null;
  const range = atrPct !== null ? 1.5 * atrPct : 5;
  const move = change !== null ? r1(clamp((change * dir) / range) * 100) : null;
  const phase = rsi !== null ? r1(clamp(((side === "short" ? 100 - rsi : rsi) - 50) / 30) * 100) : null;

  const parts: Array<[number, number]> = [[age, 0.4], ...(move !== null ? [[move, 0.35] as [number, number]] : []), ...(phase !== null ? [[phase, 0.25] as [number, number]] : [])];
  const score = r1(parts.reduce((s, [v, w]) => s + v * w, 0) / parts.reduce((s, [, w]) => s + w, 0));
  const against = change !== null && change * dir < -0.5 * range;
  const label: StaleLabel = against ? "invalidated" : score < 35 ? "fresh" : score < 65 ? "aging" : "stale";
  const reasons = [
    `posted ${r1(ageH)} h before RYO's reading`,
    change !== null ? `24 h move ${change >= 0 ? "+" : ""}${r1(change)}% vs a day's range of ${r1(range)}%${atrPct === null ? " (no ATR: 5% assumed range)" : ""}` : "24 h move not available from RYO",
    rsi !== null ? `RSI(14) ${r1(rsi)}` : "RSI(14) not available from RYO",
    ...(against ? ["price already moved against the call by more than half a day's range"] : []),
  ];
  const marketOk: Availability = !ryo || ryo.status !== "live" ? "unavailable" : move !== null && phase !== null ? "available" : move !== null || phase !== null ? "partial" : "unavailable";
  const availability: Record<string, Availability> = { age: "available", market_state: marketOk };
  const paths = f ? [f.change24hPct, f.rsi, f.atr, f.price].flatMap((x) => (x && x.ok ? [`${x.evidence}.${x.path}`] : [])) : [];
  return envelope({
    tool: STALE_TOOL,
    status: statusFrom([availability.age!, marketOk]),
    data_mode: ryo?.status === "live" ? "live" : "unknown",
    as_of: asOf,
    request,
    data: { symbol, side, age_h: r1(ageH), components: { age, move, phase }, inputs: { change_24h_pct: change, atr_pct: atrPct !== null ? r1(atrPct) : null, rsi_14: rsi, ryo_evidence: ryo?.id ?? null, ryo_paths: paths }, score, label, reasons },
    summary: { headline: `${symbol} ${side} call is ${label} (${score}/100).`, key_points: reasons },
    availability,
    warnings: marketOk === "available" ? [] : [ryo ? `RYO evidence ${ryo.id} is ${ryo.status}${marketOk === "partial" ? " or incomplete" : ""}: score uses ${parts.length} of 3 components` : "no RYO evidence supplied: age only"],
  });
}

export const STALE_DEFINITION: SkillDefinition = {
  name: STALE_TOOL,
  description:
    "Measures how stale a long/short call is against RYO's live state of the token: age of the post, how much of a day's range the price has already travelled in the call's direction, and RSI(14). Returns a 0–100 score and fresh/aging/stale/invalidated. Read-only; calls RYO analyze_token for the market state.",
  inputSchema: {
    type: "object",
    required: ["symbol", "side", "posted_at"],
    properties: {
      symbol: { type: "string", description: "Token symbol, e.g. SOL" },
      side: { type: "string", enum: ["long", "short"] },
      posted_at: { type: "string", format: "date-time", description: "When the call was posted" },
    },
  },
};
