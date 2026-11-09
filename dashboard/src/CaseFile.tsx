import { useEffect, useMemo, useState } from "react";
import { auditLedger, MAX_SIZE_BPS, STOP_LOSS_BPS, TRUST_DELTA } from "@echo/shared/audit";
import type { LedgerSnapshot } from "@echo/shared/ledger";
import { reasonFor } from "@echo/shared/reasons";
import { PriceCheck, SourcePosts } from "./components/Corroboration";
import { SiteLayout } from "./components/SiteChrome";
import { etherscanTx, LEDGER_ADDRESS, shortHash, useLedger } from "./data/ledger";
import { watchlist } from "./data/pipeline";
import { SITE_HOST } from "./data/site";

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const stamp = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(iso)) + " UTC";
const certNo = (id: string) => `EL-${id.slice(2, 6).toUpperCase()}-${id.slice(6, 10).toUpperCase()}`;
const bigintSafe = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function Body({ snapshot }: { snapshot: LedgerSnapshot }) {
  const audit = useMemo(() => auditLedger(snapshot), [snapshot]);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  useEffect(() => {
    void sha256(JSON.stringify(snapshot, bigintSafe)).then(setFingerprint);
  }, [snapshot]);

  const positions = [...snapshot.positions].sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt));
  const traded = positions.filter((p) => p.side !== "NONE");
  const settled = traded.filter((p) => p.settled);
  const wins = settled.filter((p) => (p.pnlBps ?? 0) > 0).length;
  const total = settled.reduce((s, p) => s + (p.pnlBps ?? 0), 0);
  const period = positions.length ? `${day(positions[0]!.openedAt)} – ${day(snapshot.fetchedAt)}` : "—";

  const sources = [...snapshot.kols]
    .map((k) => {
      const steps = audit.replay.filter((s) => s.kolId.toLowerCase() === k.kolId.toLowerCase());
      return {
        ...k,
        wins: steps.filter((s) => s.pnlBps > 0).length,
        losses: steps.filter((s) => s.pnlBps < 0).length,
        echoes: steps.filter((s) => s.echo).length,
        platform: watchlist.find((w) => w.handle === k.label)?.platform ?? "fixture",
      };
    })
    .sort((a, b) => b.score - a.score);

  return (
    <article className="cert casefile">
      <div className="cert__frame">
        <header className="cert__head">
          <div className="cert__brand"><span className="cert__mark" aria-hidden="true">◐</span><span>Echo Ledger</span></div>
          <div className="cert__no"><span>Case file</span><strong>EL-BOOK-{snapshot.latestBlock}</strong></div>
        </header>
        <p className="cert__eyebrow">Record of an autonomous agent's decisions</p>
        <h1 className="cert__title">Case File</h1>
        <p className="cert__statement">
          Every decision the Echo Ledger agent recorded between <b>{period}</b>, with its grounds, the sources relied on, the outcome, the effect on each
          source's public track record, and evidence kept by third parties. Compiled from the EchoLedger contract on Ethereum Sepolia at block{" "}
          <b>{snapshot.latestBlock.toLocaleString("en-US")}</b> and re-derived in the reader's browser.
        </p>

        <section className="cert__section">
          <h2><span>1</span> Summary of the record</h2>
          <dl className="cert__dl casefile__summary">
            <dt>Decisions recorded</dt><dd>{positions.length} ({traded.length} opened, {positions.length - traded.length} rejected by the risk gate)</dd>
            <dt>Settled outcomes</dt><dd>{settled.length} settled · {wins} gains · {settled.length - wins} losses · {total > 0 ? "+" : ""}{total} bps in total</dd>
            <dt>Trust updates</dt><dd>{snapshot.trustUpdates.length} across {snapshot.kols.length} sources</dd>
            <dt>Independent audit</dt><dd className={audit.ok ? "is-win" : "is-loss"}>{audit.passed} of {audit.total} checks pass</dd>
            <dt>Contract</dt><dd className="cert__mono">{LEDGER_ADDRESS}</dd>
            <dt>Record fingerprint</dt><dd className="cert__mono">SHA-256 {fingerprint ?? "computing…"}</dd>
          </dl>
        </section>

        <section className="cert__section">
          <h2><span>2</span> Index of decisions</h2>
          <table className="casefile__table">
            <thead><tr><th>Certificate</th><th>Opened</th><th>Subject</th><th>Decision</th><th>Grounds</th><th>Outcome</th><th>Record</th></tr></thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id}>
                  <td className="cert__mono"><a href={`/record/${p.id}`}>{certNo(p.id)}</a></td>
                  <td>{stamp(p.openedAt)}</td>
                  <td>{p.token}</td>
                  <td>{p.attestation}{p.side === "NONE" ? "" : ` · ${p.side.toLowerCase()} ${(p.sizeBps / 100).toFixed(1)}%`}</td>
                  <td>{reasonFor(p)?.text ?? "—"}</td>
                  <td className={p.pnlBps == null ? "" : p.pnlBps > 0 ? "is-win" : p.pnlBps < 0 ? "is-loss" : ""}>
                    {p.side === "NONE" ? "no position" : p.pnlBps == null ? "open" : `${p.pnlBps > 0 ? "+" : ""}${p.pnlBps} bps`}
                  </td>
                  <td className="cert__mono"><a href={etherscanTx(p.openTx)} target="_blank" rel="noreferrer">{shortHash(p.openTx, 6, 4)}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="cert__section casefile__break">
          <h2><span>3</span> Track record of each source</h2>
          <table className="casefile__table">
            <thead><tr><th>Source</th><th>Platform</th><th>Settled calls</th><th>Gains</th><th>Losses</th><th>Echo calls</th><th>Trust now</th></tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.kolId}>
                  <td>{s.label ?? shortHash(s.kolId, 6, 4)}</td>
                  <td>{s.platform}</td>
                  <td>{s.trades}</td>
                  <td>{s.wins}</td>
                  <td>{s.losses}</td>
                  <td>{s.echoes}</td>
                  <td>{(s.score / 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="casefile__note">Every source starts at 50%. Each settled call moves it {TRUST_DELTA / 100} points up for a gain and down for a loss, and {TRUST_DELTA / 100} more down if the source only repeated someone else.</p>
        </section>

        <section className="cert__section">
          <h2><span>4</span> Independent audit</h2>
          <ul className="cert__verify casefile__checks">
            {audit.checks.map((c) => (
              <li key={c.id} className={c.passed === c.total ? "" : "is-bad"}>
                <span aria-hidden="true">{c.passed === c.total ? "✓" : "✗"}</span> <b>{c.label}</b> — {c.passed}/{c.total}. <i>{c.rule}</i>
              </li>
            ))}
          </ul>
        </section>

        <section className="cert__section casefile__break">
          <h2><span>5</span> Corroboration outside the chain</h2>
          <p className="corr__lead">For each settled position: the exchange's own 1-minute price record at entry and exit, and the original public posts the agent relied on. None of these depend on Ethereum, Chainlink or Echo Ledger.</p>
          {settled.map((p) => (
            <div key={p.id} className="casefile__corr">
              <h3>{certNo(p.id)} · {p.token} {p.side.toLowerCase()} · {p.pnlBps! > 0 ? "+" : ""}{p.pnlBps} bps</h3>
              <ul className="corr__list">
                <PriceCheck label="Entry price" token={p.token} price={p.entryPrice} at={p.openedAt} />
                {p.exitPrice != null && p.settledAt && <PriceCheck label="Exit price" token={p.token} price={p.exitPrice} at={p.settledAt} />}
              </ul>
              <SourcePosts position={p} />
            </div>
          ))}
        </section>

        <section className="cert__section">
          <h2><span>6</span> Rules applied</h2>
          <ul className="casefile__rules">
            <li>Only independent voices count; a post that quotes, forwards or repeats another source counts for nothing. A narrative needs 2 independent voices and a 0.60 agreement score.</li>
            <li>A bull, a bear and a judge argue every narrative that passes. The reasoning card is hashed (keccak256) and only the hash goes on-chain.</li>
            <li>The CRE record workflow re-checks the card with its own prices (3 sources within 1%) and applies the risk gate: at most {MAX_SIZE_BPS / 100}% per position and a limit on open positions. Its reason code is stored with the decision.</li>
            <li>The CRE settle workflow closes each position after 24 hours, or earlier at the {STOP_LOSS_BPS / 100}% stop, on the median of at least 2 agreeing price sources.</li>
            <li>The CRE reputation workflow rescores every source behind a settled position. The contract accepts reports only from the Keystone forwarder and cannot be edited.</li>
          </ul>
        </section>

        <footer className="cert__sign">
          <div><span className="cert__line" /><b>Recorded by</b><small>Chainlink CRE · record, settle, reputation</small></div>
          <div><span className="cert__line" /><b>Kept by</b><small className="cert__mono">EchoLedger {LEDGER_ADDRESS ? shortHash(LEDGER_ADDRESS, 8, 6) : ""}</small></div>
          <div><span className="cert__line" /><b>Compiled by the reader</b><small>{stamp(new Date().toISOString())}</small></div>
        </footer>
        <p className="cert__fine">
          Practice positions on a public test network; no capital was at risk. Not financial or legal advice. Anyone can regenerate this file from public data
          with <span className="cert__mono">bun run verify</span> or by opening {SITE_HOST}/casefile.
        </p>
      </div>
      <div className="cert__actions no-print">
        <button type="button" className="ec-button" onClick={() => window.print()}>Print / save as PDF</button>
        <a className="ghost-button" href="/#ledger">← Back to the ledger</a>
      </div>
    </article>
  );
}

export function CaseFilePage() {
  const ledger = useLedger();
  const snapshot = ledger.status === "live" ? ledger.snapshot : ledger.status === "error" ? ledger.snapshot : undefined;
  useEffect(() => {
    document.title = "Case File — Echo Ledger";
  }, []);
  return (
    <SiteLayout active="card">
      <div className="cert-page casefile-page">
        {snapshot ? <Body snapshot={snapshot} /> : <p className="ledger-empty mono-font panel">Reading the record from Ethereum Sepolia…</p>}
      </div>
    </SiteLayout>
  );
}
