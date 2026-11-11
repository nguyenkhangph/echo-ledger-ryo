import type { Hex } from "viem";
import { independentScore } from "../echo";
import { marketFacts, tokenFacts } from "./adapter";
import { counterfactuals, decide, type Decision, type Voice } from "./decision";
import type { RyoEvidence } from "./evidence";
import type { CheckedClaim } from "./claims";
import type { DecisionInput } from "./decision";
import type { SkillEnvelope } from "./skills/envelope";
import type { StaleData } from "./skills/stale";
import type { IndependenceData } from "./skills/independence";

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
  /** stale_call skill per original (non-echo) call, computed from the same deep_analysis evidence. */
  stale?: Array<{ handle: string; post_id: string; envelope: SkillEnvelope<StaleData> }>;
  /** narrative_independence skill on this narrative's posts. */
  independence?: SkillEnvelope<IndependenceData>;
};
/** A later re-call of deep_analysis and analyze_token for one token (bun run ryo:recheck), with before and after. */
export type RyoRecheck = {
  token: string;
  at: string;
  evidence: RyoEvidence[];
  before: { verdict: string; hash: Hex; headline: string };
  after: { verdict: string; hash: Hex; headline: string };
  changed: boolean;
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
  rechecks?: RyoRecheck[];
};

const symbolOf = (e: RyoEvidence) => String(e.args.symbol ?? "").toUpperCase();

/**
 * Rebuilds a narrative's decision input from the run's stored evidence alone. `drop` removes tools, which is how the
 * dashboard answers "what if deep_analysis had been down?" without calling RYO.
 */
export function rebuildInput(run: RyoRun, n: RyoRunNarrative, opts: { drop?: string[]; evidence?: RyoEvidence[] } = {}): DecisionInput {
  const pool = opts.evidence ?? run.evidence;
  const keep = (e: RyoEvidence | undefined) => (e && !opts.drop?.includes(e.tool) ? e : undefined);
  const byTool = (tool: string, pred: (e: RyoEvidence) => boolean = () => true) => keep(pool.find((e) => e.tool === tool && pred(e)) ?? (opts.evidence ? run.evidence.find((e) => e.tool === tool && pred(e)) : undefined));
  const market = marketFacts(byTool("market_overview"), byTool("monitor_market_sentiment_shift"));
  const deep = byTool("deep_analysis", (e) => symbolOf(e) === n.token);
  const quick = byTool("analyze_token", (e) => symbolOf(e) === n.token);
  const compare = byTool("compare_tokens", (e) => String(e.args.symbols).toUpperCase().startsWith(n.token === "BTC" ? "BTC, ETH" : `${n.token},`));
  const hint = independentScore(n.voices).side === "bearish" ? "SHORT" : "LONG";
  const facts = tokenFacts(n.token, deep, compare, n.token === "BTC" ? "ETH" : n.peer, hint, quick);
  return { token: n.token, voices: n.voices, market, facts };
}

/** Recomputes every decision of a saved run from its stored evidence alone. No RYO call is made. */
export function replayRun(run: RyoRun): Array<{ token: string; stored: Hex; replayed: Hex; same: boolean; verdict: string }> {
  return run.narratives.map((n) => {
    const d = decide(rebuildInput(run, n));
    return { token: n.token, stored: n.decision.hash, replayed: d.hash, same: d.hash === n.decision.hash, verdict: d.verdict };
  });
}

/** Decision for a narrative with some RYO tools removed, from stored evidence. */
export function decideWithout(run: RyoRun, n: RyoRunNarrative, drop: string[]) {
  return decide(rebuildInput(run, n, { drop }));
}
