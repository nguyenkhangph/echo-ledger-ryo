import type { Hex } from "viem";
import { cardHash } from "../hash";
import type { RyoEvidence } from "./evidence";
import type { Fact } from "./facts";
import { rebuildInput, type RyoRun } from "./run";
import { tokenFacts } from "./adapter";

/**
 * Settlement after the horizon, on RYO data only. For each narrative of a run: the price at decision time comes from
 * the run's own evidence; the price at the horizon comes from a new analyze_token call. Each KOL call is scored
 * right or wrong by direction (a move inside ±0.25% is flat and scores nothing), and trust moves by the same rule as
 * the on-chain reputation workflow: +2.5 for a right call, −2.5 for a wrong one, −2.5 more when the call was an echo.
 * A narrative whose price at either end is missing is not settled; its reason is recorded instead.
 */
export const FLAT_BAND_PCT = 0.25;
export const TRUST_STEP = 2.5;

export type CallResult = { handle: string; post_id: string; sentiment: string; echo: boolean; result: "right" | "wrong" | "flat" | "no_call"; trust_delta: number };
export type NarrativeSettlement =
  | {
      token: string;
      settled: true;
      verdict: string;
      decided_at: string;
      settled_at: string;
      horizon_h: number;
      price_then: number;
      price_then_evidence: string;
      price_now: number;
      price_now_evidence: string;
      move_pct: number;
      practice_pnl_bps: number | null;
      calls: CallResult[];
      card_hash: Hex;
    }
  | { token: string; settled: false; reason: string };

export type RyoSettlement = { kind: "echo-ledger/ryo-settlement@1"; runId: string; settledAt: string; evidence: RyoEvidence[]; narratives: NarrativeSettlement[]; digest: Hex };

const hoursBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;

export function settleRun(run: RyoRun, priceNow: (token: string) => RyoEvidence | undefined, settledAt: string, horizonH = 24): Omit<RyoSettlement, "evidence" | "digest"> {
  const narratives: NarrativeSettlement[] = run.narratives.map((n) => {
    const elapsed = hoursBetween(run.startedAt, settledAt);
    if (elapsed < horizonH) return { token: n.token, settled: false, reason: `horizon not reached: ${elapsed.toFixed(1)} of ${horizonH} h` };
    const then: Fact<number> = rebuildInput(run, n).facts.price;
    if (!then.ok) return { token: n.token, settled: false, reason: `no live RYO price at decision time (${then.reason})` };
    const ev = priceNow(n.token);
    const now = ev ? tokenFacts(n.token, ev, undefined, null, "NONE").price : null;
    if (!now || !now.ok) return { token: n.token, settled: false, reason: `no live RYO price at the horizon${now && !now.ok ? ` (${now.reason})` : ""}` };
    const move = ((now.value - then.value) / then.value) * 100;
    const dir = Math.abs(move) <= FLAT_BAND_PCT ? 0 : Math.sign(move);
    const calls: CallResult[] = n.sources.map((s) => {
      const want = s.sentiment === "bullish" ? 1 : s.sentiment === "bearish" ? -1 : 0;
      const result: CallResult["result"] = want === 0 ? "no_call" : dir === 0 ? "flat" : want === dir ? "right" : "wrong";
      const base = result === "right" ? TRUST_STEP : result === "wrong" ? -TRUST_STEP : 0;
      return { handle: s.handle, post_id: s.post_id, sentiment: s.sentiment, echo: s.is_echo, result, trust_delta: base + (s.is_echo && want !== 0 ? -TRUST_STEP : 0) };
    });
    const plan = n.decision.plan;
    const pnl = plan ? Math.round((plan.side === "LONG" ? 1 : -1) * move * 100) : null;
    const body = { token: n.token, verdict: n.decision.verdict, decided_at: run.startedAt, settled_at: settledAt, horizon_h: horizonH, price_then: then.value, price_then_evidence: then.evidence, price_now: now.value, price_now_evidence: now.evidence, move_pct: Number(move.toFixed(4)), practice_pnl_bps: pnl, calls };
    return { ...body, settled: true as const, card_hash: cardHash({ settles: n.cardHash, ...body }) };
  });
  return { kind: "echo-ledger/ryo-settlement@1", runId: run.runId, settledAt, narratives };
}

export type SourceValidity = { handle: string; calls: number; right: number; wrong: number; flat: number; echoes: number; hit_rate: number | null; trust_delta: number; tokens: string[] };

/** Per-source track record across settlements, by outcome at the horizon (never by follower count). */
export function sourceValidity(settlements: Array<Pick<RyoSettlement, "narratives">>): SourceValidity[] {
  const rows = new Map<string, SourceValidity>();
  for (const s of settlements)
    for (const n of s.narratives) {
      if (!n.settled) continue;
      for (const c of n.calls) {
        if (c.result === "no_call") continue;
        const r = rows.get(c.handle) ?? { handle: c.handle, calls: 0, right: 0, wrong: 0, flat: 0, echoes: 0, hit_rate: null, trust_delta: 0, tokens: [] };
        r.calls += 1;
        if (c.result === "right") r.right += 1;
        if (c.result === "wrong") r.wrong += 1;
        if (c.result === "flat") r.flat += 1;
        if (c.echo) r.echoes += 1;
        r.trust_delta += c.trust_delta;
        if (!r.tokens.includes(n.token)) r.tokens.push(n.token);
        rows.set(c.handle, r);
      }
    }
  return [...rows.values()]
    .map((r) => ({ ...r, hit_rate: r.right + r.wrong ? r.right / (r.right + r.wrong) : null }))
    .sort((a, b) => b.trust_delta - a.trust_delta || a.handle.localeCompare(b.handle));
}
