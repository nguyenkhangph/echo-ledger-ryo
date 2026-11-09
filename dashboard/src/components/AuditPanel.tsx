import { useMemo, useState } from "react";
import { auditForPosition, auditLedger, type AuditResult } from "@echo/shared/audit";
import type { LedgerPosition, LedgerSnapshot } from "@echo/shared/ledger";
import { etherscanTx, LEDGER_ADDRESS, shortHash } from "../data/ledger";
import { REPO_URL } from "../data/site";

export function useAudit(snapshot: LedgerSnapshot): AuditResult {
  return useMemo(() => auditLedger(snapshot), [snapshot]);
}

const sepoliaChainId = 11155111;
const bigintSafe = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

async function sha256Hex(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Everything a third party needs to re-check one decision, plus a SHA-256 of the body so a copy cannot be quietly edited. */
export async function buildProofPack(position: LedgerPosition, snapshot: LedgerSnapshot, audit: AuditResult) {
  const body = {
    kind: "echo-ledger/proof-pack@1",
    chain: { name: "Ethereum Sepolia", chainId: sepoliaChainId },
    contract: snapshot.address,
    readAtBlock: snapshot.latestBlock,
    position,
    audit: auditForPosition(audit, position),
    verifyWith: `bun run verify  (${REPO_URL.replace("https://", "")})`,
    transactions: {
      open: etherscanTx(position.openTx),
      ...(position.settleTx ? { settle: etherscanTx(position.settleTx) } : {}),
    },
  };
  const text = JSON.stringify(body, bigintSafe, 2);
  return { sha256: await sha256Hex(text), body: JSON.parse(text) as unknown };
}

export function ProofPackButton({ position, snapshot, audit }: { position: LedgerPosition; snapshot: LedgerSnapshot; audit: AuditResult }) {
  const [hash, setHash] = useState<string | null>(null);
  const download = async () => {
    try {
      const pack = await buildProofPack(position, snapshot, audit);
      setHash(pack.sha256);
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `echo-ledger-proof-${position.token.toLowerCase()}-${position.id.slice(2, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setHash(null);
    }
  };
  return (
    <button type="button" className="proof-btn mono-font" onClick={download} title="A JSON file with the on-chain record, the re-derived checks and a SHA-256 of its contents">
      {hash ? `proof pack · sha256 ${hash.slice(0, 8)}…` : "↓ proof pack"}
    </button>
  );
}

function trustPct(score: number) {
  return `${(score / 100).toFixed(1)}%`;
}

type Tamper = { id: string; label: string; story: string; apply: (copy: LedgerSnapshot) => void };

/** Edits a judge can make to a private copy of the chain data, to watch the audit catch them. Nothing is written anywhere. */
const TAMPERS: Tamper[] = [
  {
    id: "pnl",
    label: "Turn a loss into a win",
    story: "You rewrote the worst settled trade as a +400 bps win, as an operator hiding a bad call might.",
    apply: (copy) => {
      const p = [...copy.positions].filter((x) => x.settled).sort((a, b) => (a.pnlBps ?? 0) - (b.pnlBps ?? 0))[0];
      if (p) p.pnlBps = 400;
    },
  },
  {
    id: "trust",
    label: "Inflate a source's trust",
    story: "You gave the top source an extra 5 points of trust, both in its event history and in the contract's stored score.",
    apply: (copy) => {
      const kol = [...copy.kols].sort((a, b) => b.score - a.score)[0];
      if (!kol) return;
      kol.score += 500;
      const last = [...copy.trustUpdates].reverse().find((u) => u.kolId === kol.kolId);
      if (last) last.score += 500;
    },
  },
  {
    id: "size",
    label: "Hide an oversized bet",
    story: "You changed one position to 12% of the book, more than double the 5% risk limit.",
    apply: (copy) => {
      const p = copy.positions.find((x) => x.side !== "NONE");
      if (p) p.sizeBps = 1200;
    },
  },
  {
    id: "early",
    label: "Close a trade early",
    story: "You moved one settlement to six hours after it opened, cashing out before the 24-hour horizon.",
    apply: (copy) => {
      const p = copy.positions.find((x) => x.settled && Math.abs(x.pnlBps ?? 0) < 800);
      if (p) p.settledAt = new Date(Date.parse(p.openedAt) + 6 * 3_600_000).toISOString();
    },
  },
];

export function AuditPanel({ snapshot, audit: liveAudit }: { snapshot: LedgerSnapshot; audit: AuditResult }) {
  const [open, setOpen] = useState(false);
  const [tamperId, setTamperId] = useState<string | null>(null);
  const tamper = TAMPERS.find((t) => t.id === tamperId) ?? null;
  const audit = useMemo(() => {
    if (!tamper) return liveAudit;
    const copy = structuredClone(snapshot);
    tamper.apply(copy);
    return auditLedger(copy);
  }, [tamper, snapshot, liveAudit]);
  const failed = audit.total - audit.passed;
  return (
    <section id="audit" className={`panel audit${audit.ok ? "" : " audit--fail"}${tamper ? " audit--tampered" : ""}`} aria-labelledby="audit-title">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Don't trust us, replay it · runs in your browser</p>
          <h2 id="audit-title">Independent audit</h2>
        </div>
        <span className={`audit__seal mono-font${audit.ok ? "" : " is-fail"}`}>
          <i aria-hidden="true" />
          {audit.ok ? `${audit.total}/${audit.total} checks pass` : `${failed} of ${audit.total} checks fail`}
        </span>
      </div>

      <p className="audit__lead">
        The page re-derives profit and loss, risk limits and every source's trust score from the public Sepolia record alone, with the same rules the contract and the CRE workflows apply. Nothing below is read from our own database.
      </p>

      <div className="tamper">
        <div className="tamper__head">
          <span className="mono-font tamper__kicker">Try to tamper</span>
          <span className="tamper__hint">Edit a private copy of the chain data and watch the audit react. Nothing leaves your browser.</span>
        </div>
        <div className="tamper__options" role="group" aria-label="Tamper scenarios">
          {TAMPERS.map((t) => (
            <button key={t.id} type="button" className={`tamper__btn mono-font${t.id === tamperId ? " is-active" : ""}`} aria-pressed={t.id === tamperId} onClick={() => setTamperId((cur) => (cur === t.id ? null : t.id))}>
              {t.label}
            </button>
          ))}
          {tamper && (
            <button type="button" className="tamper__btn tamper__btn--reset mono-font" onClick={() => setTamperId(null)}>
              ↺ Restore chain data
            </button>
          )}
        </div>
        {tamper && (
          <p className="tamper__verdict" role="status">
            <strong>{audit.ok ? "Not caught." : `Caught by ${audit.checks.filter((c) => c.passed !== c.total).length} ${audit.checks.filter((c) => c.passed !== c.total).length === 1 ? "check" : "checks"}.`}</strong> {tamper.story}{" "}
            {audit.ok ? "" : "The record on Sepolia cannot be edited, so any copy that disagrees with it is exposed."}
          </p>
        )}
      </div>

      <ul className="audit__checks">
        {audit.checks.map((check) => {
          const ok = check.passed === check.total;
          return (
            <li key={`${check.id}-${tamperId ?? "live"}`} className={ok ? "is-ok" : "is-bad"}>
              <span className="audit__mark mono-font" aria-hidden="true">{ok ? "✓" : "✗"}</span>
              <div>
                <strong>{check.label}</strong>
                <small>{check.rule}</small>
                {check.failures.map((failure) => (
                  <small key={failure.subject} className="audit__failure mono-font">{failure.subject}: {failure.message}</small>
                ))}
              </div>
              <span className="audit__count mono-font">{check.passed}/{check.total}</span>
            </li>
          );
        })}
      </ul>

      <div className="audit__foot">
        <button type="button" className="audit__toggle mono-font" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"} the trust replay ({audit.replay.length} steps)
        </button>
        <span className="audit__foot-end">
          <a className="proof-btn proof-btn--cert mono-font" href="/casefile">§ printable case file</a>
          <code className="audit__cmd mono-font">$ bun run verify</code>
        </span>
      </div>

      {open && (
        <div className="audit__table-wrap">
          <table className="audit__table mono-font">
            <thead>
              <tr><th>Source</th><th>Position</th><th>Result</th><th>Rule</th><th>On chain</th><th /></tr>
            </thead>
            <tbody>
              {audit.replay.map((step) => (
                <tr key={`${step.positionId}-${step.kolId}`} className={step.onChain === step.after ? "" : "is-bad"}>
                  <td>{step.label ?? shortHash(step.kolId, 6, 4)}</td>
                  <td>{step.token} {step.pnlBps > 0 ? "+" : ""}{step.pnlBps} bps{step.echo ? " · echo" : ""}</td>
                  <td>{trustPct(step.before)} → {trustPct(step.after)}</td>
                  <td>{step.after - step.before > 0 ? "+" : ""}{(step.after - step.before) / 100} pts</td>
                  <td>{step.onChain == null ? "—" : trustPct(step.onChain)}</td>
                  <td className="audit__ok">{step.onChain === step.after ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="audit__note mono-font">Contract {LEDGER_ADDRESS ? shortHash(LEDGER_ADDRESS, 8, 6) : ""} · block {snapshot.latestBlock.toLocaleString("en-US")} · rule: +2.5 pts on a win, −2.5 on a loss, −2.5 more for an echo</p>
    </section>
  );
}
