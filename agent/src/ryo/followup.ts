import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decide, EvidenceBook, evidenceDigest, rebuildInput, settleRun, type RyoEvidence, type RyoRecheck, type RyoRun, type RyoSettlement } from "@echo/shared/ryo";
import { RyoClient } from "./client";

/** Highest evidence number used by a run and its rechecks, so follow-up evidence continues the sequence. */
function lastEvidenceNo(run: RyoRun): number {
  const ids = [...run.evidence, ...(run.rechecks ?? []).flatMap((r) => r.evidence)].map((e) => Number(e.id.slice(1)));
  return ids.length ? Math.max(...ids) : 0;
}

async function record(client: RyoClient, book: EvidenceBook, tool: string, args: Record<string, unknown>, log: (s: string) => void): Promise<RyoEvidence> {
  const r = await client.call(tool, args);
  const payload = r.envelope ?? (r.error ? { error: r.error, http_status: r.httpStatus, trace_id: r.traceId } : null);
  const e = book.add(tool, args, payload, r.calledAt, !r.ok);
  log(`  ${e.id} ${tool}(${JSON.stringify(args)}) → ${e.status}${e.statusReason ? ` · ${e.statusReason}` : ""}${r.error ? ` · ${r.error}` : ""}`);
  return e;
}

/**
 * Re-calls deep_analysis and analyze_token for one token of a saved run, decides again with the new readings (market
 * and basket evidence stay as recorded) and appends the before/after to the run file. The original evidence and
 * decision are untouched, so replay still reproduces the original hash.
 */
export async function recheckToken(opts: { runFile: string; token: string; client?: RyoClient; now?: () => Date; log?: (s: string) => void }): Promise<RyoRecheck> {
  const log = opts.log ?? console.log;
  const client = opts.client ?? new RyoClient();
  const run = JSON.parse(readFileSync(opts.runFile, "utf8")) as RyoRun;
  const T = opts.token.toUpperCase();
  const n = run.narratives.find((x) => x.token === T);
  if (!n) throw new Error(`${T} is not a decided narrative in ${opts.runFile} (decided: ${run.narratives.map((x) => x.token).join(", ") || "none"})`);
  const book = new EvidenceBook(lastEvidenceNo(run));
  log(`Re-checking ${T} from run ${run.runId}`);
  const deep = await record(client, book, "deep_analysis", { symbol: T, include_perp: false }, log);
  const quick = await record(client, book, "analyze_token", { symbol: T }, log);
  const after = decide(rebuildInput(run, n, { evidence: [deep, quick] }));
  const recheck: RyoRecheck = {
    token: T,
    at: (opts.now ?? (() => new Date()))().toISOString(),
    evidence: book.all(),
    before: { verdict: n.decision.verdict, hash: n.decision.hash, headline: n.decision.headline },
    after: { verdict: after.verdict, hash: after.hash, headline: after.headline },
    changed: after.verdict !== n.decision.verdict,
  };
  run.rechecks = [...(run.rechecks ?? []), recheck];
  writeFileSync(opts.runFile, JSON.stringify(run, null, 2) + "\n");
  log(`  before: ${recheck.before.verdict} · after: ${recheck.after.verdict}${recheck.changed ? " (changed)" : " (same outcome)"}`);
  return recheck;
}

/**
 * Settles every saved run whose 24 h horizon has passed and that has no settlement yet: one analyze_token call per
 * decided token for the price at the horizon, then the shared settlement rules. Writes fixtures/ryo/settlements/.
 */
export async function settleDue(opts: { runsDir: string; outDir: string; client?: RyoClient; now?: () => Date; log?: (s: string) => void; force?: boolean }): Promise<RyoSettlement[]> {
  const log = opts.log ?? console.log;
  const client = opts.client ?? new RyoClient();
  const now = (opts.now ?? (() => new Date()))().toISOString();
  mkdirSync(opts.outDir, { recursive: true });
  const out: RyoSettlement[] = [];
  const runs = existsSync(opts.runsDir) ? readdirSync(opts.runsDir).filter((f) => f.endsWith(".json") && f !== "latest.json").sort() : [];
  for (const f of runs) {
    const run = JSON.parse(readFileSync(join(opts.runsDir, f), "utf8")) as RyoRun;
    const target = join(opts.outDir, `${run.runId}.json`);
    if (existsSync(target) && !opts.force) continue;
    if (!run.narratives.length) continue;
    const hours = (Date.parse(now) - Date.parse(run.startedAt)) / 3_600_000;
    if (hours < 24) {
      log(`${run.runId}: ${hours.toFixed(1)} h old, horizon is 24 h, not yet`);
      continue;
    }
    log(`Settling ${run.runId} (${hours.toFixed(1)} h old)`);
    const book = new EvidenceBook(lastEvidenceNo(run));
    const prices = new Map<string, RyoEvidence>();
    for (const n of run.narratives) prices.set(n.token, await record(client, book, "analyze_token", { symbol: n.token }, log));
    const body = settleRun(run, (t) => prices.get(t), now);
    const settlement: RyoSettlement = { ...body, evidence: book.all(), digest: evidenceDigest(book.all()) };
    writeFileSync(target, JSON.stringify(settlement, null, 2) + "\n");
    for (const n of settlement.narratives) log(`  ${n.token}: ${n.settled ? `${n.move_pct.toFixed(2)}% · ${n.calls.filter((c) => c.result === "right").length} right / ${n.calls.filter((c) => c.result === "wrong").length} wrong` : `not settled · ${n.reason}`}`);
    out.push(settlement);
  }
  if (!out.length) log("Nothing due for settlement.");
  return out;
}
