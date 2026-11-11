import { useMemo, useState } from "react";
import { decideWithout, FINFLUENCER_CASES, replayRun, runEval, sourceValidity, type Decision, type RyoEvidence, type RyoRun, type RyoRunNarrative, type RyoSettlement } from "@echo/shared/ryo";
import { SiteLayout } from "./components/SiteChrome";
import { latestRyoRun, ryoRuns, ryoSettlements } from "./data/ryo";

/** Every evidence item a run can cite: its own calls, later rechecks, and settlement price reads. */
const allEvidence = (run: RyoRun): RyoEvidence[] => [
  ...run.evidence,
  ...(run.rechecks ?? []).flatMap((r) => r.evidence),
  ...ryoSettlements.filter((s) => s.runId === run.runId).flatMap((s) => s.evidence),
];

const t = (iso: string) => new Date(iso).toUTCString().slice(5, 22) + " UTC";
const VERDICT: Record<Decision["verdict"], { label: string; tone: string }> = {
  OPEN: { label: "Practice position", tone: "win" },
  REJECT: { label: "Rejected", tone: "loss" },
  NOT_ANALYZABLE: { label: "Not analysable", tone: "muted" },
  INSUFFICIENT_EVIDENCE: { label: "Missing evidence", tone: "amber" },
};

function EvidenceChip({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="ryo-chip mono-font" onClick={() => onOpen(id)} title="Open the RYO payload">
      {id}
    </button>
  );
}

function EvidenceModal({ run, id, onClose }: { run: RyoRun; id: string; onClose: () => void }) {
  const e = allEvidence(run).find((x) => x.id === id);
  if (!e) return null;
  return (
    <div className="ryo-modal" role="dialog" aria-modal="true" aria-label={`Evidence ${id}`} onClick={onClose}>
      <div className="ryo-modal__box" onClick={(ev) => ev.stopPropagation()}>
        <div className="ryo-modal__head">
          <strong className="mono-font">{e.id} · {e.tool}({JSON.stringify(e.args)})</strong>
          <button type="button" className="ryo-chip mono-font" onClick={onClose}>close</button>
        </div>
        <p className="mono-font ryo-muted">
          status <b className={`ryo-st ryo-st--${e.status}`}>{e.status}</b>
          {e.statusReason ? ` · ${e.statusReason}` : ""} · fetched {t(e.fetchedAt)} · keccak256 {e.payloadHash.slice(0, 18)}…
        </p>
        <pre className="ryo-modal__json mono-font">{JSON.stringify(e.payload, null, 2)}</pre>
      </div>
    </div>
  );
}

function DecisionLine({ d, label }: { d: Decision; label: string }) {
  const v = VERDICT[d.verdict];
  return (
    <div className={`ryo-col ryo-col--${v.tone}`}>
      <span className="mono-font ryo-muted">{label}</span>
      <strong className="display-font">{d.score.toFixed(2)}</strong>
      <em className="mono-font">{v.label}{d.side !== "NONE" ? ` · ${d.side.toLowerCase()}` : ""}</em>
      <small className="mono-font ryo-muted">{d.agreeing} of {d.independent} {d.options.countEchoes ? "posts" : "independent voices"} · bar {d.threshold.toFixed(2)}</small>
    </div>
  );
}

function download(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function evidencePack(run: RyoRun, n: RyoRunNarrative) {
  const used = new Set<string>([...n.decision.gates.flatMap((g) => g.evidence), ...(n.decision.plan ? [n.decision.plan.priceEvidence] : []), ...n.claims.flatMap((c) => c.evidence)]);
  return {
    kind: "echo-ledger/evidence-pack@1",
    run: { id: run.runId, startedAt: run.startedAt, endpoint: run.endpoint, digest: run.digest },
    token: n.token,
    kol_posts: n.sources,
    echo_graph: n.sources.map((s) => ({ kol: s.handle, echo: s.is_echo, echo_of: s.echo_of })),
    ryo_payloads: run.evidence.filter((e) => used.has(e.id)),
    card: n.card,
    card_hash: n.cardHash,
    decision: n.decision,
    rechecks: (run.rechecks ?? []).filter((r) => r.token === n.token),
    settlement: ryoSettlements.filter((s) => s.runId === run.runId).flatMap((s) => s.narratives.filter((x) => x.token === n.token)),
    skills: { narrative_independence: n.independence ?? null, stale_call: n.stale ?? [] },
    note: "Practice decision on recorded public posts and RYO-CHAN research output. Not financial or legal advice.",
  };
}

function Propagation({ n }: { n: RyoRunNarrative }) {
  const rows = [...n.sources].filter((s) => s.posted_at).sort((a, b) => a.posted_at!.localeCompare(b.posted_at!));
  if (!rows.length) return null;
  const first = Date.parse(rows[0]!.posted_at!);
  const corroborated = new Set(n.decision.voices.filter((v) => v.ryo === "corroborated").map((v) => v.handle));
  return (
    <div className="ryo-prop">
      <h4 className="mono-font">Propagation · who spoke first, who only repeated</h4>
      <ol>
        {rows.map((s) => {
          const h = (Date.parse(s.posted_at!) - first) / 3_600_000;
          const role = s.is_echo ? `repeated ${s.echo_of ?? "another source"}` : h === 0 ? "first" : corroborated.has(s.handle) ? "later, backed by RYO data" : "later, independent";
          return (
            <li key={s.post_id} className={s.is_echo ? "is-echo" : ""}>
              <span className="mono-font">+{h.toFixed(1)} h</span>
              <b>{s.handle}</b>
              <span className="ryo-muted">{s.sentiment} · {role}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Narrative({ run, n, open }: { run: RyoRun; n: RyoRunNarrative; open: (id: string) => void }) {
  const [mode, setMode] = useState<"actual" | "naive" | "noveto" | "nodeep" | "noquick" | `drop:${string}`>("actual");
  const cf = n.counterfactuals;
  const tools = useMemo(() => ({ nodeep: decideWithout(run, n, ["deep_analysis"]), noquick: decideWithout(run, n, ["analyze_token"]) }), [run, n]);
  const hasQuick = run.evidence.some((e) => e.tool === "analyze_token" && String(e.args.symbol).toUpperCase() === n.token);
  const alt =
    mode === "naive" ? cf.naive : mode === "noveto" ? cf.withoutRyoVetoes : mode === "nodeep" ? tools.nodeep : mode === "noquick" ? tools.noquick : mode.startsWith("drop:") ? cf.withoutEach.find((x) => x.handle === mode.slice(5))?.decision ?? cf.actual : null;
  const liveIds = new Set(allEvidence(run).filter((e) => e.status === "live").map((e) => e.id as string));
  const staleBy = new Map((n.stale ?? []).map((x) => [x.handle, x.envelope]));
  const rechecks = (run.rechecks ?? []).filter((r) => r.token === n.token);
  const d = n.decision;
  const v = VERDICT[d.verdict];
  const handles = [...new Set(n.voices.map((x) => x.handle))];
  return (
    <article className={`panel ryo-card ryo-card--${v.tone}`}>
      <header className="ryo-card__head">
        <div>
          <span className="mono-font ryo-muted">{n.token} · {n.voices.filter((x) => !x.is_echo).length} independent · {n.voices.filter((x) => x.is_echo).length} echo</span>
          <h3>{d.verdict === "INSUFFICIENT_EVIDENCE" ? `${d.token}: not decided. ${d.missing.length} pieces of live RYO data are missing (listed below), so nothing is estimated.` : d.headline}</h3>
        </div>
        <span className={`ryo-pill ryo-pill--${v.tone} mono-font`}>{v.label}</span>
      </header>

      <div className="ryo-cols">
        <DecisionLine d={cf.naive} label="Naive bot · counts every post, no RYO" />
        <DecisionLine d={d} label="Echo Ledger + RYO" />
      </div>

      <div className="ryo-cause" role="group" aria-label="Cause and effect">
        <span className="mono-font ryo-muted">What if…</span>
        <button type="button" className={`ryo-chip mono-font${mode === "naive" ? " is-on" : ""}`} onClick={() => setMode(mode === "naive" ? "actual" : "naive")}>echoes counted</button>
        <button type="button" className={`ryo-chip mono-font${mode === "noveto" ? " is-on" : ""}`} onClick={() => setMode(mode === "noveto" ? "actual" : "noveto")}>RYO vetoes ignored</button>
        <button type="button" className={`ryo-chip mono-font${mode === "nodeep" ? " is-on" : ""}`} onClick={() => setMode(mode === "nodeep" ? "actual" : "nodeep")}>deep_analysis down</button>
        {hasQuick && <button type="button" className={`ryo-chip mono-font${mode === "noquick" ? " is-on" : ""}`} onClick={() => setMode(mode === "noquick" ? "actual" : "noquick")}>analyze_token down</button>}
        {handles.map((h) => (
          <button key={h} type="button" className={`ryo-chip mono-font${mode === `drop:${h}` ? " is-on" : ""}`} onClick={() => setMode(mode === `drop:${h}` ? "actual" : `drop:${h}`)}>without {h}</button>
        ))}
      </div>
      {alt && (
        <p className="ryo-after mono-font">
          Before: <b>{VERDICT[d.verdict].label}</b> ({d.score.toFixed(2)}) → after: <b>{VERDICT[alt.verdict].label}</b> ({alt.score.toFixed(2)}).{" "}
          {alt.verdict === d.verdict ? "The outcome does not depend on this." : "This alone changes the outcome."}
          {(mode === "nodeep" || mode === "noquick") && " Recomputed from the stored payloads with that tool removed."}
        </p>
      )}

      <div className="ryo-recheck mono-font">
        <span className="ryo-muted">Call deep_analysis again:</span>
        {rechecks.length === 0 ? (
          <span className="ryo-muted"> not re-checked yet · <code>bun run ryo:recheck --token {n.token}</code> calls deep_analysis and analyze_token now and records the before/after here</span>
        ) : (
          rechecks.map((r, i) => (
            <span key={i}>
              {" "}{t(r.at)}: <b>{VERDICT[r.before.verdict as Decision["verdict"]]?.label ?? r.before.verdict}</b> → <b>{VERDICT[r.after.verdict as Decision["verdict"]]?.label ?? r.after.verdict}</b>
              {r.changed ? " (changed)" : " (same outcome)"} {r.evidence.map((e) => <EvidenceChip key={e.id} id={e.id} onOpen={open} />)}
            </span>
          ))
        )}
      </div>

      {d.plan && (
        <div className="ryo-plan mono-font">
          <span>Entry <b>{d.plan.entry}</b></span>
          <span>Stop <b>{d.plan.stop}</b> (−{d.plan.stopPct}%)</span>
          <span>Target <b>{d.plan.target}</b> (2R)</span>
          <span>Size <b>{(d.plan.sizeBps / 100).toFixed(2)}%</b> · {d.plan.horizonH} h</span>
          <span className="ryo-muted">computed in code from RYO's live price <EvidenceChip id={d.plan.priceEvidence} onOpen={open} /> · practice only, no real money</span>
        </div>
      )}

      <ul className="ryo-gates">
        {d.gates.map((g) => {
          // A gate that "passes" only because its RYO evidence is missing is shown as not verified, not as a pass.
          const unverified = g.passed && g.ryoVeto && g.evidence.length > 0 && g.evidence.every((id) => liveIds.has(id) === false);
          return (
          <li key={g.id} className={unverified ? "is-unverified" : g.passed ? "is-ok" : "is-bad"}>
            <span aria-hidden="true">{unverified ? "?" : g.passed ? "✓" : "✗"}</span>
            <b>{g.label}</b>
            <span className="ryo-muted">{g.detail}</span>
            <span>{g.evidence.map((id) => <EvidenceChip key={id} id={id} onOpen={open} />)}</span>
          </li>
          );
        })}
      </ul>
      {d.missing.length > 0 && <p className="ryo-missing mono-font">Missing, not guessed: {d.missing.join(" · ")}</p>}

      <div className="ryo-voices">
        {d.voices.map((x, i) => (
          <span key={`${x.handle}-${i}`} className={`ryo-voice ryo-voice--${x.ryo}${x.echo ? " is-echo" : ""}`} title={x.note}>
            {x.handle} · {x.sentiment}{x.echo ? " · echo" : ""} · {x.ryo}
            {!x.echo && staleBy.get(x.handle)?.data ? ` · ${staleBy.get(x.handle)!.data!.label}` : ""}
          </span>
        ))}
      </div>
      {(n.stale?.length ?? 0) > 0 && (
        <p className="mono-font ryo-muted ryo-skillnote">
          stale_call: {n.stale!.map((x) => `${x.handle} ${x.envelope.data ? `${x.envelope.data.label} ${x.envelope.data.score}/100 (${x.envelope.data.age_h} h old)` : x.envelope.status}`).join(" · ")}
        </p>
      )}
      {n.independence?.data && (
        <p className="mono-font ryo-muted ryo-skillnote">
          narrative_independence: {n.independence.summary.headline} {n.independence.summary.key_points[0]}
        </p>
      )}

      <Propagation n={n} />

      <details className="ryo-claims">
        <summary className="mono-font">Claims on the card: {n.claims.filter((c) => c.kept).length} kept, {n.claims.filter((c) => !c.kept).length} removed</summary>
        <ul>
          {n.claims.map((c, i) => (
            <li key={i} className={c.kept ? "" : "is-bad"}>
              {c.kept ? "✓" : "✗"} {c.text} {c.evidence.map((id) => <EvidenceChip key={id} id={id} onOpen={open} />)} <span className="ryo-muted mono-font">{c.reason}</span>
            </li>
          ))}
        </ul>
      </details>

      <footer className="ryo-card__foot mono-font">
        <span className="ryo-muted">card keccak256 {n.cardHash.slice(0, 18)}… · decision {d.hash.slice(0, 12)}…</span>
        <button type="button" className="ryo-chip" onClick={() => download(`echo-ledger-${n.token.toLowerCase()}-${run.runId}.json`, evidencePack(run, n))}>↓ evidence pack</button>
      </footer>
    </article>
  );
}

function Replay({ run }: { run: RyoRun }) {
  const [rows, setRows] = useState<ReturnType<typeof replayRun> | null>(null);
  return (
    <div className="ryo-replay">
      <button type="button" className="ec-button" onClick={() => setRows(replayRun(run))}>Replay this run</button>
      <span className="mono-font ryo-muted">Recomputes every decision from the stored RYO payloads in your browser. No RYO call.</span>
      {rows && (
        <p className="mono-font">
          {rows.filter((r) => r.same).length}/{rows.length} decisions reproduced with the same hash
          {rows.map((r) => <span key={r.token} className={r.same ? "ryo-ok" : "ryo-bad"}> · {r.token} {r.same ? "✓" : "✗"}</span>)}
        </p>
      )}
    </div>
  );
}

function Validity({ settlements }: { settlements: RyoSettlement[] }) {
  const rows = sourceValidity(settlements);
  const pending = settlements.flatMap((s) => s.narratives.filter((n) => !n.settled));
  return (
    <div className="panel ryo-ev">
      <h3>Source validity · right or wrong at the 24 h horizon, by RYO's price (not by followers)</h3>
      {rows.length === 0 ? (
        <p className="ryo-muted">
          No settled calls yet. <code>bun run ryo:settle</code> reads RYO's analyze_token price 24 h after each run, scores every KOL call by direction (±0.25% is flat),
          and moves trust +2.5 / −2.5, with −2.5 more for an echo.{pending.length ? ` Not settled: ${pending.map((n) => `${n.token} (${"reason" in n ? n.reason : ""})`).join(" · ")}.` : ""}
        </p>
      ) : (
        <table className="mono-font">
          <thead><tr><th>Source</th><th>Calls</th><th>Right</th><th>Wrong</th><th>Flat</th><th>Echo calls</th><th>Hit rate</th><th>Trust Δ</th><th>Tokens</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.handle}>
                <td>{r.handle}</td><td>{r.calls}</td><td className="ryo-ok">{r.right}</td><td className="ryo-bad">{r.wrong}</td><td>{r.flat}</td><td>{r.echoes}</td>
                <td>{r.hit_rate === null ? "—" : `${Math.round(r.hit_rate * 100)}%`}</td>
                <td className={r.trust_delta >= 0 ? "ryo-ok" : "ryo-bad"}>{r.trust_delta > 0 ? "+" : ""}{r.trust_delta}</td>
                <td>{r.tokens.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Finfluencer() {
  const rows = useMemo(() => runEval().rows.filter((r) => FINFLUENCER_CASES.includes(r.id)), []);
  return (
    <div className="panel ryo-ev">
      <h3>Finfluencer case · loud promotion is not evidence</h3>
      <p className="ryo-muted">
        Two cases from the eval set, decided by the same rules as live runs. One account promotes a token and others repost it; Echo Ledger counts the reposts as one
        voice and asks RYO whether the market backs it. Illustrative only: this is not legal advice and makes no finding about any real person.
      </p>
      <ul className="ryo-gates">
        {rows.map((r) => (
          <li key={r.id} className="is-bad">
            <span aria-hidden="true">✗</span>
            <b>{r.title}</b>
            <span className="ryo-muted">{VERDICT[r.got as Decision["verdict"]]?.label ?? r.got} · {r.headline.replace(/^TKN: /, "").replace(/^rejected in public\. /, "")}</span>
          </li>
        ))}
      </ul>
      <p className="mono-font ryo-muted">bun run ryo:eval · {runEval().correct}/{runEval().total} cases correct · 0 invented numbers</p>
    </div>
  );
}

function EvidenceTable({ run, open }: { run: RyoRun; open: (id: string) => void }) {
  return (
    <div className="panel ryo-ev">
      <h3>Evidence ledger · every RYO call, including failures</h3>
      <table className="mono-font">
        <thead><tr><th>Id</th><th>Tool</th><th>Arguments</th><th>Status</th><th>Detail</th><th>Payload</th></tr></thead>
        <tbody>
          {allEvidence(run).map((e: RyoEvidence) => {
            const call = run.calls.find((c) => c.evidence === e.id);
            return (
              <tr key={e.id}>
                <td><EvidenceChip id={e.id} onOpen={open} /></td>
                <td>{e.tool}</td>
                <td>{JSON.stringify(e.args)}</td>
                <td><span className={`ryo-st ryo-st--${e.status}`}>{e.status}</span></td>
                <td className="ryo-muted">{e.statusReason ?? "ok · live"}{call?.attempts && call.attempts > 1 ? ` · ${call.attempts} attempts` : ""}{call?.error ? ` · ${call.error}` : ""}</td>
                <td className="ryo-muted">{e.payloadHash.slice(0, 12)}…</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RyoPage() {
  const run = latestRyoRun;
  const [openId, setOpenId] = useState<string | null>(null);
  const blocked = useMemo(() => run?.calls.filter((c) => !c.ok && /allowance|RATE_LIMITED|429/.test(`${c.error} ${c.httpStatus}`)) ?? [], [run]);
  return (
    <SiteLayout active="ryo">
      <div className="ryo-page">
        <p className="section-kicker">RYO-CHAN research layer × Echo Ledger</p>
        <h1 className="ryo-title">What the crowd says, checked against RYO's live data</h1>
        <p className="ryo-lead">
          Echo Ledger folds reposts into the voice they repeat, then asks RYO-CHAN's six research tools whether the independent voices are backed by the
          market. Every number below cites the RYO payload it came from (E1, E2, …). Practice decisions only; no real money; not financial or legal advice.
        </p>

        {!run ? (
          <div className="panel ryo-empty">
            <h3>No RYO run recorded yet</h3>
            <p>Run <code>bun run ryo:run</code> with a valid <code>RYO_MCP_KEY</code>; the run is saved to <code>fixtures/ryo/runs/</code> and appears here. Nothing on this page is ever filled with placeholder data.</p>
          </div>
        ) : (
          <>
            <div className="ryo-meta mono-font">
              <span>Run {t(run.startedAt)}</span>
              <span>{run.quota.calls} RYO calls · {run.quota.failed} failed</span>
              <span>{run.narratives.length} narratives decided · {run.skipped.length} skipped</span>
              <span>evidence digest {run.digest.slice(0, 14)}…</span>
              {ryoRuns.length > 1 && <span>{ryoRuns.length} runs recorded</span>}
            </div>
            {blocked.length > 0 && (
              <div className="panel ryo-blocked">
                <strong>RYO refused {blocked.length} of {run.calls.length} calls in this run.</strong> {blocked[0]!.error}. Echo Ledger recorded the refusals as
                evidence and decided nothing it could not back: affected narratives show "Missing evidence", never estimated numbers.
              </div>
            )}
            <Replay run={run} />
            {run.scan.symbols.length > 0 && (
              <div className="panel ryo-scan">
                <h3>RYO first: what scan_market ranks, and who said it independently <EvidenceChip id={run.scan.evidence ?? ""} onOpen={setOpenId} /></h3>
                <ul>
                  {run.scan.mentions.map((m) => (
                    <li key={m.symbol}>
                      <b>{m.symbol}</b>{" "}
                      <span className="ryo-muted">
                        {m.independent.length ? `independent: ${m.independent.join(", ")}` : "no independent KOL"}
                        {m.echoes.length ? ` · echo only: ${m.echoes.join(", ")}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="ryo-list">
              {run.narratives.map((n) => <Narrative key={n.token} run={run} n={n} open={setOpenId} />)}
            </div>
            {run.skipped.length > 0 && (
              <p className="mono-font ryo-muted">Not sent to RYO: {run.skipped.map((s) => `${s.token} (${s.reason})`).join(" · ")}</p>
            )}
            <Validity settlements={ryoSettlements} />
            <EvidenceTable run={run} open={setOpenId} />
            {openId && <EvidenceModal run={run} id={openId} onClose={() => setOpenId(null)} />}
          </>
        )}
        <Finfluencer />
      </div>
    </SiteLayout>
  );
}
