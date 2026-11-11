import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  counterfactuals,
  decide,
  EvidenceBook,
  evidenceDigest,
  evidenceIndex,
  marketFacts,
  peerOf,
  tokenFacts,
  verifyClaims,
  type Claim,
  type Decision,
  type RyoEvidence,
  type Voice,
} from "@echo/shared/ryo";
import { canonicalJson, cardHash } from "@echo/shared/hash";
import { independentScore } from "@echo/shared/echo";
import { RyoClient, type RyoCall } from "./client";

/**
 * The RYO stage: KOL narratives (already folded for echoes) meet RYO-CHAN's live research layer.
 *  1. market_overview and monitor_market_sentiment_shift once per run (market regime, reversal alarm);
 *  2. scan_market once, to see which tokens RYO ranks first and which KOLs mentioned them independently;
 *  3. for each narrative with an independent voice: deep_analysis and compare_tokens (token, BTC, a fixed peer);
 *  4. the deterministic rules decide; every number cites its evidence id and payload path.
 * Every response, including failures, is kept as evidence, so the run can be replayed without calling RYO again.
 */

type CandidateSource = { post_id: string; handle: string; sentiment: Voice["sentiment"]; conviction: number; is_echo: boolean; echo_of: string | null; reasoning_summary: string };
type Candidate = { token: string; window_h: number; sources: CandidateSource[] };

export type CallRecord = Omit<RyoCall, "envelope"> & { evidence: string };

export type NarrativeResult = {
  token: string;
  voices: Voice[];
  sources: CandidateSource[];
  peer: string;
  decision: Decision;
  counterfactuals: ReturnType<typeof counterfactuals>;
  claims: ReturnType<typeof verifyClaims>;
  card: Record<string, unknown>;
  cardHash: `0x${string}`;
};

export type RyoRun = {
  kind: "echo-ledger/ryo-run@1";
  runId: string;
  startedAt: string;
  finishedAt: string;
  endpoint: string;
  candidatesFile: string;
  evidence: RyoEvidence[];
  calls: CallRecord[];
  scan: { evidence: string | null; symbols: string[]; mentions: Array<{ symbol: string; independent: string[]; echoes: string[] }> };
  narratives: NarrativeResult[];
  skipped: Array<{ token: string; reason: string }>;
  quota: { calls: number; failed: number; rateLimitRemaining: number | null };
  digest: `0x${string}`;
};

export function loadCandidates(file: string): Candidate[] {
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Candidate);
}

export function latestCandidatesFile(dir: string): string {
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  if (!files.length) throw new Error(`No candidates in ${dir}. Run ingest → extract → converge first.`);
  return join(dir, files[files.length - 1]!);
}

/** Claims written from facts, each tied to its evidence id and payload path. The LLM never writes these numbers. */
function claimsFrom(decision: Decision, f: ReturnType<typeof tokenFacts>): Claim[] {
  const out: Claim[] = [];
  const add = (by: Claim["by"], text: string, fact: { ok: boolean } & Record<string, unknown>, value?: number | string) => {
    if (!fact.ok) return;
    out.push({ by, text, evidence: [fact.evidence as `E${number}`], path: fact.path as string, value });
  };
  if (f.price.ok) add("judge", `${f.token} last price ${f.price.value}`, f.price, f.price.value);
  if (f.change24hPct.ok) add("judge", `24 h change ${f.change24hPct.value}%`, f.change24hPct, f.change24hPct.value);
  if (f.direction.ok) out.push({ by: f.direction.value === "up" ? "bull" : f.direction.value === "down" ? "bear" : "judge", text: `RYO direction reads ${f.direction.value}`, evidence: [f.direction.evidence], path: f.direction.path });
  if (f.atr?.ok) add("judge", `ATR(14) ${f.atr.value}`, f.atr, f.atr.value);
  for (const g of decision.gates) out.push({ by: g.passed ? "bull" : "bear", text: `${g.label}: ${g.detail}`, evidence: g.evidence });
  return out;
}

export async function runRyoStage(opts: { candidatesFile: string; outDir: string; maxTokens?: number; client?: RyoClient; now?: () => Date; log?: (s: string) => void }): Promise<RyoRun> {
  const log = opts.log ?? console.log;
  const now = opts.now ?? (() => new Date());
  const client = opts.client ?? new RyoClient();
  const startedAt = now().toISOString();
  const book = new EvidenceBook();
  const calls: CallRecord[] = [];
  let remaining: number | null = null;

  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await client.call(tool, args);
    const payload = r.envelope ?? (r.error ? { error: r.error, http_status: r.httpStatus, trace_id: r.traceId } : null);
    const e = book.add(tool, args, payload, r.calledAt, !r.ok);
    const { envelope: _drop, ...meta } = r;
    calls.push({ ...meta, evidence: e.id });
    if (r.rateLimit.remaining != null) remaining = r.rateLimit.remaining;
    log(`  ${e.id} ${tool}(${JSON.stringify(args)}) → ${e.status}${e.statusReason ? ` · ${e.statusReason}` : ""}${r.error ? ` · ${r.error}` : ""}`);
    return e;
  };

  const candidates = loadCandidates(opts.candidatesFile);
  // Attach each source's posting time (for the propagation map) from the ingest log, when available.
  const postsDir = join(opts.candidatesFile, "../../posts");
  const postedAt = new Map<string, string>();
  if (existsSync(postsDir))
    for (const f of readdirSync(postsDir).filter((x) => x.endsWith(".jsonl")))
      for (const line of readFileSync(join(postsDir, f), "utf8").split("\n"))
        if (line.trim())
          try {
            const p = JSON.parse(line) as { id?: string; posted_at?: string };
            if (p.id && p.posted_at) postedAt.set(p.id, p.posted_at);
          } catch {
            /* a corrupt line is skipped, not fatal */
          }
  for (const c of candidates) for (const s of c.sources) (s as CandidateSource & { posted_at?: string }).posted_at = postedAt.get(s.post_id);
  log(`RYO stage on ${candidates.length} narratives from ${opts.candidatesFile}`);

  const overview = await call("market_overview", {});
  const sentiment = await call("monitor_market_sentiment_shift", {});
  const scan = await call("scan_market", { top_n: 10 });

  const market = marketFacts(overview, sentiment);
  const scanSymbols: string[] = [];
  if (scan.status === "live") {
    const seen = new Set<string>();
    const walk = (n: unknown, d: number) => {
      if (!n || typeof n !== "object" || d > 5) return;
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (/^(symbol|ticker)$/i.test(k) && typeof v === "string" && !seen.has(v.toUpperCase())) {
          seen.add(v.toUpperCase());
          scanSymbols.push(v.toUpperCase());
        } else walk(v, d + 1);
      }
    };
    walk((scan.payload as Record<string, unknown>)?.data, 0);
  }
  const mentions = scanSymbols.map((symbol) => {
    const c = candidates.find((x) => x.token.toUpperCase() === symbol);
    return { symbol, independent: [...new Set(c?.sources.filter((s) => !s.is_echo).map((s) => s.handle) ?? [])], echoes: [...new Set(c?.sources.filter((s) => s.is_echo).map((s) => s.handle) ?? [])] };
  });

  // Spend quota only where a narrative has at least one independent voice, strongest first.
  const ranked = candidates
    .map((c) => ({ c, s: independentScore(c.sources) }))
    .sort((a, b) => b.s.voices - a.s.voices || b.s.score - a.s.score || a.c.token.localeCompare(b.c.token));
  const skipped: RyoRun["skipped"] = [];
  const chosen: Candidate[] = [];
  for (const { c, s } of ranked) {
    if (s.voices === 0) skipped.push({ token: c.token, reason: "only echoes: no independent voice, RYO not called" });
    else if (chosen.length >= (opts.maxTokens ?? 4)) skipped.push({ token: c.token, reason: "outside this run's call budget" });
    else chosen.push(c);
  }

  const narratives: NarrativeResult[] = [];
  for (const c of chosen) {
    const T = c.token.toUpperCase();
    const peer = peerOf(T);
    const voices: Voice[] = c.sources.map((s) => ({ handle: s.handle, sentiment: s.sentiment, conviction: s.conviction, is_echo: s.is_echo }));
    const hint = independentScore(voices).side === "bearish" ? "SHORT" : "LONG";
    log(`\n${T}: ${voices.filter((v) => !v.is_echo).length} independent, ${voices.filter((v) => v.is_echo).length} echo`);
    const deep = await call("deep_analysis", { symbol: T, include_perp: false });
    const symbols = T === "BTC" ? `BTC, ETH, SOL` : `${T}, BTC, ${peer}`;
    const compare = deep.status === "unavailable" && /unknown|not (found|supported)|invalid/i.test(String((deep.payload as Record<string, unknown>)?.error ?? "")) ? undefined : await call("compare_tokens", { symbols, intent: "swing" });
    const facts = tokenFacts(T, deep, compare, T === "BTC" ? "ETH" : peer, hint);
    const input = { token: T, voices, market, facts };
    const decision = decide(input);
    const cf = counterfactuals(input);
    const claims = verifyClaims(claimsFrom(decision, facts), book);
    const used = [...new Set([overview.id, sentiment.id, deep.id, ...(compare ? [compare.id] : [])])];
    const card = {
      kind: "echo-ledger/ryo-card@1",
      token: T,
      verdict: decision.verdict,
      side: decision.side,
      headline: decision.headline,
      plan: decision.plan,
      convergence: { score: decision.score, threshold: decision.threshold, independent: decision.independent, agreeing: decision.agreeing },
      sources: c.sources.map((s) => ({ kol: s.handle, post: s.post_id, sentiment: s.sentiment, echo: s.is_echo, echo_of: s.echo_of })),
      voices: decision.voices,
      gates: decision.gates.map((g) => ({ id: g.id, passed: g.passed, detail: g.detail, evidence: g.evidence })),
      claims: claims.filter((x) => x.kept).map((x) => ({ by: x.by, text: x.text, evidence: x.evidence, path: x.path ?? null })),
      removed_claims: claims.filter((x) => !x.kept).map((x) => ({ text: x.text, reason: x.reason })),
      ryo_evidence: evidenceIndex(book.all().filter((e) => used.includes(e.id))),
      decision_hash: decision.hash,
      practice_only: true,
    };
    const hash = cardHash(card);
    narratives.push({ token: T, voices, sources: c.sources, peer, decision, counterfactuals: cf, claims, card, cardHash: hash });
    log(`  → ${decision.verdict}: ${decision.headline}`);
  }

  const evidence = book.all();
  const run: RyoRun = {
    kind: "echo-ledger/ryo-run@1",
    runId: startedAt.replace(/[:.]/g, "-"),
    startedAt,
    finishedAt: now().toISOString(),
    endpoint: client.config.url,
    candidatesFile: opts.candidatesFile.replace(/^.*fixtures\//, "fixtures/"),
    evidence,
    calls,
    scan: { evidence: scan.id, symbols: scanSymbols, mentions },
    narratives,
    skipped,
    quota: { calls: calls.length, failed: calls.filter((x) => !x.ok).length, rateLimitRemaining: remaining },
    digest: evidenceDigest(evidence),
  };
  mkdirSync(opts.outDir, { recursive: true });
  const path = join(opts.outDir, `${run.runId}.json`);
  writeFileSync(path, JSON.stringify(run, null, 2) + "\n");
  writeFileSync(join(opts.outDir, "latest.json"), JSON.stringify({ run: `${run.runId}.json` }) + "\n");
  log(`\nWrote ${path} · ${calls.length} RYO calls (${run.quota.failed} failed) · digest ${run.digest}`);
  return run;
}

export { replayRun } from "@echo/shared/ryo";

export const canonical = canonicalJson;
export { existsSync };
