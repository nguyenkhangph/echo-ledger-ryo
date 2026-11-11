import { useEffect, useState } from "react";
import { exampleCards } from "@echo/shared/fixtures";
import { cardHash } from "@echo/shared/hash";
import type { LedgerPosition, LedgerSnapshot } from "@echo/shared/ledger";
import { draftCards } from "../data/pipeline";
import { etherscanAddress, etherscanTx, LEDGER_ADDRESS, shortHash, useLedger } from "../data/ledger";
import { Reveal, SectionHeading } from "./SiteChrome";
import { AuditPanel, ProofPackButton, useAudit } from "./AuditPanel";
import type { AuditResult } from "@echo/shared/audit";
import { reasonFor } from "@echo/shared/reasons";

function formatPrice(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: value < 1 ? 6 : 2 });
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(iso)) + " UTC";
}

/** Compact UTC time for the chain steps, e.g. "Oct 28 13:41". */
function chainTime(iso: string) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
  const hm = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(d);
  return `${day} ${hm}`;
}

function ChainTx({ hash }: { hash: string }) {
  return (
    <a className="tx-link tx-link--chain" href={etherscanTx(hash)} target="_blank" rel="noreferrer" title={hash}>
      tx <span>{shortHash(hash, 4, 4)}</span> ↗
    </a>
  );
}

function TxLink({ hash, label }: { hash: string; label: string }) {
  return (
    <a className="tx-link" href={etherscanTx(hash)} target="_blank" rel="noreferrer" title={hash}>
      {label} <span>{shortHash(hash)}</span> ↗
    </a>
  );
}

/** Reasoning cards this dashboard can open, keyed by the hash the contract stores. */
const knownCards = new Map([...draftCards, ...exampleCards].map((card) => [cardHash(card).toLowerCase(), card.card_id]));

/** Positions settle 24 h after they open (the horizon the record workflow writes). */
const HORIZON_MS = 24 * 3_600_000;
/** The reputation workflow answers a settlement within a block or two; allow generous slack. */
const TRUST_WINDOW_MS = 30 * 60_000;

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function countdown(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

type Step = { key: string; title: string; state: "done" | "pending" | "next"; main: React.ReactNode; sub?: React.ReactNode; link?: React.ReactNode };

function ProofChain({ position, snapshot, recordedOnly }: { position: LedgerPosition; snapshot: LedgerSnapshot; recordedOnly: boolean }) {
  const now = useNow();
  const cardId = knownCards.get(position.cardHash.toLowerCase());
  const echoes = position.sources.filter((source) => source.echo).length;
  const names = position.sources.map((source) => source.label ?? shortHash(source.kolId, 6, 4));

  const settledMs = position.settledAt ? Date.parse(position.settledAt) : null;
  const sourceIds = new Set(position.sources.map((source) => source.kolId.toLowerCase()));
  const trust =
    settledMs == null
      ? []
      : snapshot.trustUpdates.filter((update) => {
          const at = Date.parse(update.at);
          return sourceIds.has(update.kolId.toLowerCase()) && at >= settledMs - 60_000 && at <= settledMs + TRUST_WINDOW_MS;
        });
  const trustTx = trust[0]?.tx;
  const trustCount = new Set(trust.map((update) => update.kolId.toLowerCase())).size;

  const dueIn = Date.parse(position.openedAt) + HORIZON_MS - now;

  const steps: Step[] = [
    {
      key: "voices",
      title: "Voices",
      state: "done",
      main: `${position.sources.length} ${position.sources.length === 1 ? "source" : "sources"}`,
      sub: (
        <span title={names.join(", ")}>
          {names.slice(0, 2).join(", ")}
          {names.length > 2 ? ` +${names.length - 2}` : ""}
          {echoes ? ` · ${echoes} echo` : ""}
        </span>
      ),
    },
    {
      key: "card",
      title: "Card hash",
      state: "done",
      main: <span className="mono-font">{shortHash(position.cardHash, 6, 4)}</span>,
      link: cardId ? <a className="tx-link" href={`/card/${encodeURIComponent(cardId)}`}>Open card ✓ verified</a> : <span className="chain__muted">stored on-chain</span>,
    },
    {
      key: "open",
      title: recordedOnly ? "Decision" : "Opened",
      state: "done",
      main: <span title={formatTime(position.openedAt)}>{chainTime(position.openedAt)}</span>,
      sub: "UTC",
      link: <ChainTx hash={position.openTx} />,
    },
  ];

  if (!recordedOnly) {
    steps.push(
      position.settled && position.settleTx
        ? {
            key: "settle",
            title: "Settled",
            state: "done",
            main: position.settledAt ? <span title={formatTime(position.settledAt)}>{chainTime(position.settledAt)}</span> : "settled",
            sub: `exit ${formatPrice(position.exitPrice ?? 0)}`,
            link: <ChainTx hash={position.settleTx} />,
          }
        : {
            key: "settle",
            title: "Settles",
            state: "next",
            main: dueIn > 0 ? <span className="chain__count">in {countdown(dueIn)}</span> : <span className="chain__count">due now</span>,
            sub: dueIn > 0 ? "24 h horizon" : "waiting for the next settle run",
          },
      position.settled && trustTx
        ? {
            key: "trust",
            title: "Trust",
            state: "done",
            main: `${trustCount} rescored`,
            sub: trust[0] ? `${trust[0].label ?? "source"} → ${(trust[0].score / 100).toFixed(1)}%` : undefined,
            link: <ChainTx hash={trustTx} />,
          }
        : { key: "trust", title: "Trust", state: "pending", main: "after settlement", sub: "reputation workflow" },
    );
  }

  return (
    <ol className="chain" style={{ ["--n" as string]: steps.length }}>
      {steps.map((step, index) => {
        const nextDone = steps[index + 1]?.state === "done";
        return (
          <li key={step.key} className={`chain__step chain__step--${step.state}${step.state === "done" && nextDone ? " is-linked" : ""}`}>
            <span className="chain__dot" aria-hidden="true" />
            <span className="chain__title mono-font">{step.title}</span>
            <span className="chain__main">{step.main}</span>
            {step.sub && <span className="chain__sub mono-font">{step.sub}</span>}
            {step.link && <span className="chain__link">{step.link}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function PositionRow({ position, snapshot, audit }: { position: LedgerPosition; snapshot: LedgerSnapshot; audit: AuditResult }) {
  const pnl = position.pnlBps;
  // REJECT (and side NONE) decisions are stored for audit but never open a position.
  const recordedOnly = position.attestation === "REJECT" || position.side === "NONE";
  return (
    <article className="ledger-row">
      <div className="ledger-row__token">
        <span className="token-icon">{position.token.slice(0, 2)}</span>
        <div>
          <strong>{position.token}</strong>
          <span className="mono-font">{position.side === "NONE" ? "no position" : `${position.side.toLowerCase()} · ${(position.sizeBps / 100).toFixed(1)}%`}</span>
        </div>
      </div>
      <span className={`ledger-badge ledger-badge--${position.attestation.toLowerCase()}`}>{position.attestation}</span>
      <div className="ledger-row__prices mono-font">
        <span>entry {formatPrice(position.entryPrice)}</span>
        <span>{position.exitPrice == null ? "exit —" : `exit ${formatPrice(position.exitPrice)}`}</span>
      </div>
      <div className="ledger-row__pnl">
        {recordedOnly ? (
          <span className="ledger-status ledger-status--recorded">Recorded</span>
        ) : pnl == null ? (
          <span className="ledger-status">Open</span>
        ) : (
          <strong className={`display-font${pnl < 0 ? " is-loss" : ""}`}>{pnl < 0 ? "▼" : "▲"} {pnl > 0 ? "+" : ""}{pnl} bps</strong>
        )}
        <span className="mono-font">
          {position.settled ? `settled ${formatTime(position.settledAt!)}` : `${recordedOnly ? "decided" : "opened"} ${formatTime(position.openedAt)}`}
        </span>
        <span className="ledger-row__docs">
          <a className="proof-btn proof-btn--cert mono-font" href={`/record/${position.id}`}>§ certificate</a>
          <ProofPackButton position={position} snapshot={snapshot} audit={audit} />
        </span>
      </div>
      {position.sources.some((src) => src.label === "alice-crypto" || src.label === "block-research") && (
        <p className="ledger-row__reason mono-font">
          <span>Pipeline test</span> Recorded from a test card whose sources (alice-crypto, block-research) are fictional handles, not real KOLs. The transaction is real; the narrative is not.
        </p>
      )}
      {reasonFor(position) && (
        <p className="ledger-row__reason mono-font">
          <span>Grounds</span> {reasonFor(position)!.text} <code>{position.reasonCode}</code>
        </p>
      )}
      <ProofChain position={position} snapshot={snapshot} recordedOnly={recordedOnly} />
    </article>
  );
}

function TrustFeed({ snapshot }: { snapshot: LedgerSnapshot }) {
  if (snapshot.trustUpdates.length === 0) return <p className="ledger-empty mono-font">No trust updates yet. They appear one block after a position settles.</p>;
  return (
    <ul className="trust-feed">
      {snapshot.trustUpdates.map((update) => (
        <li key={`${update.tx}-${update.kolId}`}>
          <span className="trust-feed__dot" aria-hidden="true" />
          <strong>{update.label ?? shortHash(update.kolId, 6, 4)}</strong>
          <span className="mono-font">trust → {(update.score / 100).toFixed(1)}%</span>
          <span className="mono-font trust-feed__time">{formatTime(update.at)}</span>
          <TxLink hash={update.tx} label="Tx" />
        </li>
      ))}
    </ul>
  );
}

function LedgerBody({ snapshot }: { snapshot: LedgerSnapshot }) {
  const audit = useAudit(snapshot);
  return (
    <>
      <Reveal><AuditPanel snapshot={snapshot} audit={audit} /></Reveal>
      <div className="ledger-grid">
        <Reveal className="panel">
          <section aria-labelledby="ledger-positions-title">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Recorded by CRE · record + settle workflows</p>
                <h2 id="ledger-positions-title">Positions</h2>
              </div>
              <span className="count-badge">{snapshot.positions.length}</span>
            </div>
            {snapshot.positions.length === 0 ? (
              <p className="ledger-empty mono-font">No decisions recorded yet.</p>
            ) : (
              snapshot.positions.map((position) => <PositionRow key={position.id} position={position} snapshot={snapshot} audit={audit} />)
            )}
          </section>
        </Reveal>
        <Reveal className="panel" delay={90}>
          <section aria-labelledby="ledger-trust-title">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Reputation workflow · EVM log trigger</p>
                <h2 id="ledger-trust-title">Trust updates</h2>
              </div>
              <span className="count-badge">{snapshot.trustUpdates.length}</span>
            </div>
            <TrustFeed snapshot={snapshot} />
          </section>
        </Reveal>
      </div>
    </>
  );
}

export function OnChainLedger() {
  const ledger = useLedger();
  const snapshot = ledger.status === "live" ? ledger.snapshot : ledger.status === "error" ? ledger.snapshot : undefined;

  return (
    <section className="page-section" id="ledger" aria-labelledby="ledger-title">
      <Reveal>
        <div className="section-heading-row">
          <SectionHeading id="ledger-title" eyebrow="On-chain ledger" title="Every decision, settlement and trust change, read from Sepolia" />
          {LEDGER_ADDRESS && (
            <a className="scan-status" href={etherscanAddress(LEDGER_ADDRESS)} target="_blank" rel="noreferrer">
              <span className="live-dot" aria-hidden="true" />
              <span className="mono-font">{snapshot ? `Block ${snapshot.latestBlock.toLocaleString("en-US")}` : "EchoLedger"} · {shortHash(LEDGER_ADDRESS, 6, 4)} ↗</span>
            </a>
          )}
        </div>
      </Reveal>

      {ledger.status === "unconfigured" && <p className="ledger-empty mono-font panel">Set VITE_LEDGER_ADDRESS in dashboard/.env to read the deployed EchoLedger contract.</p>}
      {ledger.status === "loading" && <p className="ledger-empty mono-font panel">Reading EchoLedger events from Ethereum Sepolia…</p>}
      {ledger.status === "error" && (
        <p className="ledger-empty ledger-empty--error mono-font panel">
          {ledger.fallback && snapshot
            ? `Live Sepolia read unavailable right now (${ledger.error}). Showing the copy read at block ${snapshot.latestBlock.toLocaleString("en-US")} on ${new Date(snapshot.fetchedAt).toUTCString().slice(5, 22)} UTC; every figure below can be checked against Etherscan.`
            : `Could not read Sepolia${snapshot ? " (showing the last good snapshot)" : ""}: ${ledger.error}`}
        </p>
      )}

      {snapshot && <LedgerBody snapshot={snapshot} />}
    </section>
  );
}
