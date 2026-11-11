import type { Hex } from "viem";
import { independentScore } from "../echo";
import { marketFacts, tokenFacts } from "./adapter";
import { counterfactuals, decide, type Decision, type Voice } from "./decision";
import type { RyoEvidence } from "./evidence";
import type { CheckedClaim } from "./claims";

/** A saved RYO stage run, as written by `bun run ryo:run` to fixtures/ryo/runs/. */
export type RyoRunCall = { tool: string; args: Record<string, unknown>; ok: boolean; isError: boolean; error: string | null; httpStatus: number | null; traceId: string | null; attempts: number; via: string; rateLimit: { limit: number | null; remaining: number | null; reset: string | null }; calledAt: string; durationMs: number; evidence: string };
export type RyoRunSource = { post_id: string; handle: string; sentiment: Voice["sentiment"]; conviction: number; is_echo: boolean; echo_of: string | null; reasoning_summary: string; posted_at?: string };
export type RyoRunNarrative = {
  token: string;
  voices: Voice[];
  sources: RyoRunSource[];
  peer: string;
  decision: Decision;
  counterfactuals: ReturnType<typeof counterfactuals>;
  claims: CheckedClaim[];
  card: Record<string, unknown>;
  cardHash: Hex;
};
export type RyoRun = {
  kind: "echo-ledger/ryo-run@1";
  runId: string;
  startedAt: string;
  finishedAt: string;
  endpoint: string;
  candidatesFile: string;
  evidence: RyoEvidence[];
  calls: RyoRunCall[];
  scan: { evidence: string | null; symbols: string[]; mentions: Array<{ symbol: string; independent: string[]; echoes: string[] }> };
  narratives: RyoRunNarrative[];
  skipped: Array<{ token: string; reason: string }>;
  quota: { calls: number; failed: number; rateLimitRemaining: number | null };
  digest: Hex;
};

/** Recomputes every decision of a saved run from its stored evidence alone. No RYO call is made. */
export function replayRun(run: RyoRun): Array<{ token: string; stored: Hex; replayed: Hex; same: boolean; verdict: string }> {
  const byTool = (tool: string, pred: (e: RyoEvidence) => boolean = () => true) => run.evidence.find((e) => e.tool === tool && pred(e));
  const market = marketFacts(byTool("market_overview"), byTool("monitor_market_sentiment_shift"));
  return run.narratives.map((n) => {
    const deep = byTool("deep_analysis", (e) => String(e.args.symbol).toUpperCase() === n.token);
    const compare = byTool("compare_tokens", (e) => String(e.args.symbols).toUpperCase().startsWith(n.token === "BTC" ? "BTC, ETH" : `${n.token},`));
    const hint = independentScore(n.voices).side === "bearish" ? "SHORT" : "LONG";
    const facts = tokenFacts(n.token, deep, compare, n.token === "BTC" ? "ETH" : n.peer, hint);
    const d = decide({ token: n.token, voices: n.voices, market, facts });
    return { token: n.token, stored: n.decision.hash, replayed: d.hash, same: d.hash === n.decision.hash, verdict: d.verdict };
  });
}
