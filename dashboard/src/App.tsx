import { exampleCards } from "@echo/shared/fixtures";
import type { ReasoningCard } from "@echo/shared/card";
import { cardHash } from "@echo/shared/hash";
import { CardNotFound, ReasoningCardDetail } from "./ReasoningCardDetail";
import { Scorecard } from "./Scorecard";
import { CertificatePage } from "./Certificate";
import { CaseFilePage } from "./CaseFile";
import { RyoPage } from "./RyoPage";
import { JudgePage } from "./JudgePage";
import { DecisionFunnel } from "./components/DecisionFunnel";
import { EchoGraph } from "./components/EchoGraph";
import { OnChainLedger } from "./components/OnChainLedger";
import { TrustSpark } from "./components/TrustSpark";
import { ProofStrip } from "./components/ProofStrip";
import { CreFlow } from "./components/CreFlow";
import { BuildOnRecord, ComplianceMap } from "./components/ComplianceMap";
import { EclipseOrb, Reveal, SectionHeading, SiteLayout } from "./components/SiteChrome";
import { useLedger } from "./data/ledger";
import {
  candidates,
  candidatesDate,
  decodeEntities,
  draftCards,
  latestPosts,
  pipelineStats,
  relativeTime,
  signalPosts,
  snapshotTime,
  watchlistRows,
  WINDOW_HOURS,
  type WatchlistRow,
} from "./data/pipeline";

const RADAR_THRESHOLD = 0.6;

/** Cards the agent drafted come first; repository fixture cards stay listed, tagged as fixtures. */
const heroCards: Array<{ card: ReasoningCard; fixture: boolean }> = [
  ...draftCards.map((card) => ({ card, fixture: false })),
  ...exampleCards.map((card) => ({ card, fixture: true })),
]
  // The agent can re-draft the same card id on later cycles; list each card once.
  .filter(({ card }, index, all) => all.findIndex((other) => other.card.card_id === card.card_id) === index)
  .slice(0, 4);
const fixtureHashes = new Map(heroCards.map(({ card }) => [card.card_id, cardHash(card).toLowerCase()]));

const sentimentClass = (sentiment: string) => (sentiment === "bullish" ? "bull" : sentiment === "bearish" ? "bear" : "neutral");

function initialsFor(handle: string) {
  const clean = handle.replace(/^@/, "");
  const parts = clean.split(/[-_\s]+/).filter(Boolean);
  return (parts.length > 1 ? parts.map((part) => part[0]).join("") : clean.replace(/[^A-Za-z0-9]/g, "")).slice(0, 2).toUpperCase();
}

function verdictLabel(card: ReasoningCard) {
  const verdict = card.debate?.verdict ?? "HOLD";
  return verdict === "HOLD" ? "CONSTRAIN" : verdict;
}

function formatUtc(date: Date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date) + " UTC";
}

function LatestCards() {
  const ledger = useLedger();
  const snapshot = ledger.status === "live" ? ledger.snapshot : ledger.status === "error" ? ledger.snapshot : undefined;
  const onChain = new Set(snapshot?.positions.map((position) => position.cardHash.toLowerCase()) ?? []);

  return (
    <div className="hero-panel">
      <div className="hero-panel__head">
        <p className="mono-font"><span className="live-dot" aria-hidden="true" />Latest reasoning cards</p>
        <span className="mono-font">{heroCards.some((item) => !item.fixture) ? `${heroCards.filter((item) => !item.fixture).length} from the agent` : "Ethereum Sepolia"}</span>
      </div>
      <ul>
        {heroCards.map(({ card, fixture }, index) => {
          const recorded = onChain.has(fixtureHashes.get(card.card_id)!);
          return (
            <li key={card.card_id} className="pop-in" style={{ animationDelay: `${index * 70}ms` }}>
              <a className={`launch-row${index === 0 ? " launch-row--latest" : ""}`} href={`/card/${encodeURIComponent(card.card_id)}`}>
                <span className="token-icon">{card.token.slice(0, 2)}</span>
                <span className="launch-row__body">
                  <strong>
                    {card.token}
                    {fixture && <em className="row-tag">fixture</em>}
                    {recorded && <em className="row-tag row-tag--chain">on-chain ✓</em>}
                  </strong>
                  <span className="mono-font">
                    {verdictLabel(card)} · score {card.convergence.score.toFixed(2)} · {card.convergence.independent_kols} independent
                  </span>
                </span>
                <span className="launch-row__arrow" aria-hidden="true">→</span>
              </a>
            </li>
          );
        })}
      </ul>
      {draftCards.length === 0 && (
        <p className="hero-panel__note mono-font">No reasoning card has been drafted from live sources yet; a card appears here once a token passes convergence and the debate runs. Cards tagged “fixture” are repository examples used to verify the pipeline.</p>
      )}
      <a href="#radar" className="hero-panel__foot mono-font">
        Open live radar <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}

function SignalTicker() {
  const items = signalPosts.length
    ? signalPosts.map((post) => ({ key: post.id, url: post.url, handle: post.handle, token: post.signal.token!, label: post.signal.is_echo ? "echo" : post.signal.sentiment }))
    : latestPosts.slice(0, 12).map((post) => ({ key: post.id, url: post.url, handle: post.handle, token: null, label: "post" }));
  if (items.length === 0) return null;
  // One pass must be wider than any screen, or a gap shows before the loop restarts.
  const pass = Array.from({ length: Math.ceil(12 / items.length) }, () => items).flat();
  const loop = [...pass, ...pass];
  return (
    <div className="ticker" aria-label="Latest signals">
      <div className="ticker__track mono-font">
        {loop.map((item, index) => (
          <a
            key={`${item.key}-${index}`}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            aria-hidden={index >= items.length ? true : undefined}
            tabIndex={index >= items.length ? -1 : undefined}
          >
            <span className="ticker__dot" aria-hidden="true" />
            <strong>{item.handle.startsWith("@") ? item.handle : `@${item.handle}`}</strong>
            {item.token && <span>${item.token}</span>}
            <span>{item.label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

const STEPS: ReadonlyArray<{ title: string; body: string }> = [
  { title: "Ingest public voices", body: "Telegram channels and X accounts on the watchlist are read every cycle. Paid promotions are flagged and set aside, not hidden." },
  { title: "Discount the echoes", body: "Calls that quote or repeat an earlier call are folded into it. Only independent voices count toward convergence." },
  { title: "Debate before acting", body: "A bull, a bear and a judge argue the evidence. Deterministic risk rules sit after the verdict, not inside it." },
  { title: "Write the proof on-chain", body: "Every decision becomes a reasoning card. Its hash is recorded by a Chainlink CRE workflow on Sepolia." },
];

function HowItWorks() {
  return (
    <section className="page-section" aria-labelledby="steps-title">
      <Reveal>
        <SectionHeading id="steps-title" eyebrow="How it works" title="Four stages, one auditable trail" />
      </Reveal>
      <div role="list" className="steps">
        {STEPS.map((step, index) => (
          <Reveal key={step.title} delay={index * 90} className="step">
            <div role="listitem">
              <span className="mono-font step__index">0{index + 1}</span>
              <span className="step__line" aria-hidden="true" />
              <h3>{step.title}</h3>
              <p className="mono-font">{step.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function WatchlistPanel() {
  const ledger = useLedger();
  const snapshot = ledger.status === "live" ? ledger.snapshot : ledger.status === "error" ? ledger.snapshot : undefined;
  // A source counts as scored only after a trust update (trades > 0); before that it sits at its seed trust.
  const trustFor = (row: WatchlistRow) => {
    const onChain = snapshot?.kols.find((kol) => kol.label === row.handle);
    return onChain && onChain.trades > 0 ? onChain.score : row.trust * 10_000;
  };
  /** Seed trust followed by every on-chain TrustUpdated score for this source, oldest first (basis points). */
  const historyFor = (row: WatchlistRow) => {
    const updates = (snapshot?.trustUpdates ?? []).filter((update) => update.label === row.handle).sort((a, b) => a.block - b.block);
    return updates.length ? [row.trust * 10_000, ...updates.map((update) => update.score)] : [];
  };
  // Leaderboard: sources with an on-chain score first, best trust on top; unscored sources keep watchlist order.
  const ranked = watchlistRows
    .map((row, index) => ({ row, index, history: historyFor(row), trust: trustFor(row) }))
    .sort((a, b) => Number(b.history.length > 0) - Number(a.history.length > 0) || (a.history.length && b.history.length ? b.trust - a.trust : 0) || a.index - b.index);
  const scored = ranked.filter((item) => item.history.length > 0).length;

  return (
    <section aria-labelledby="watchlist-title">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">{scored ? `${scored} scored on-chain · agent/kols.json` : "agent/kols.json"}</p>
          <h2 id="watchlist-title">KOL Watchlist</h2>
        </div>
        <span className="count-badge">{watchlistRows.length}</span>
      </div>
      <div className="watchlist-labels" aria-hidden="true">
        <span>Voice</span><span>Last signal</span><span>Trust · history</span>
      </div>
      <div className="watchlist-rows">
        {ranked.map(({ row, history, trust: trustBps }, position) => {
          const trust = trustBps / 100;
          const manual = row.platform === "x" && row.lastPostAt === null;
          const delta = history.length ? (history[history.length - 1]! - history[0]!) / 100 : 0;
          return (
            <article className="kol-row" key={row.id}>
              <div className="avatar">
                {initialsFor(row.handle)}
                {history.length > 0 && <i className="rank-chip">{position + 1}</i>}
              </div>
              <div className="kol-identity">
                <a href={row.url} target="_blank" rel="noreferrer"><strong>{row.handle.startsWith("@") ? row.handle : `@${row.handle}`}</strong></a>
                <span>
                  <i className="platform-dot" /> {row.platform}
                  {" · "}
                  {manual ? "manual feed" : `${row.postsInWindow} posts / ${WINDOW_HOURS}h`}
                </span>
              </div>
              <div className="last-signal">
                {row.lastSignal ? (
                  <>
                    <span className={`sentiment ${sentimentClass(row.lastSignal.sentiment)}`}>{row.lastSignal.sentiment}</span>
                    <b>{row.lastSignal.token}</b>
                    {row.lastSignal.isEcho && <span className="echo-tag">echo</span>}
                  </>
                ) : (
                  <span className="muted-state">no call yet</span>
                )}
              </div>
              <div className="trust-cell">
                <div className="trust-cell__top">
                  <TrustSpark series={history} />
                  <span className="trust-cell__pct">{trust.toFixed(1)}%</span>
                  <span className={`trust-delta ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}`} title={history.length ? `${history.length - 1} on-chain updates since the 50% start` : "no settled call yet"}>
                    {history.length === 0 ? "—" : delta === 0 ? "0.0" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}`}
                  </span>
                </div>
                <div className="trust-track" aria-label={`${trust.toFixed(1)}% trust`}>
                  <i className="bar-shimmer" style={{ width: `${trust}%` }} />
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <p className="mock-note">Trust is the on-chain score once a source has a settled call; every source starts at 50%. ▲▼ is the change since that start.</p>
    </section>
  );
}

function ConvergencePanel() {
  return (
    <section aria-labelledby="convergence-title">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">{candidatesDate ? `Agent cycle · ${candidatesDate}` : `Last ${WINDOW_HOURS} hours`}</p>
          <h2 id="convergence-title">Convergence</h2>
        </div>
        <span className="legend"><i /> threshold {RADAR_THRESHOLD.toFixed(2)}</span>
      </div>
      {candidates.length === 0 ? (
        <p className="ledger-empty mono-font">No token has a signal in the current window yet.</p>
      ) : (
        <div className="convergence-list">
          {candidates.map((candidate) => {
            const percent = Math.max(0, candidate.convergence.score * 100);
            const above = candidate.convergence.passed;
            const independent = candidate.convergence.independent_count;
            const direction = candidate.sources.find((source) => !source.is_echo)?.sentiment ?? candidate.sources[0]?.sentiment ?? "neutral";
            return (
              <div className="token-signal" key={candidate.token}>
                <div className="token-summary">
                  <span className="token-icon">{candidate.token.slice(0, 2)}</span>
                  <div>
                    <strong>{candidate.token} <span className={`sentiment ${sentimentClass(direction)}`}>{direction}</span></strong>
                    <small>
                      {independent} independent {independent === 1 ? "voice" : "voices"}
                      {candidate.convergence.echo_count ? ` · ${candidate.convergence.echo_count} echo` : ""}
                      {!above && independent < 2 ? " · needs 2+" : ""}
                    </small>
                  </div>
                  <b className={above ? "hot-score" : ""}>{candidate.convergence.score.toFixed(2)}</b>
                </div>
                <div className="convergence-track" aria-label={`${candidate.token} convergence ${percent.toFixed(0)}%`}>
                  <span className="threshold-line" style={{ left: `${RADAR_THRESHOLD * 100}%` }} />
                  <i className={`bar-shimmer${above ? " above" : ""}`} style={{ width: `${percent}%` }} />
                </div>
                <div className="track-scale"><span>0</span><span>{above ? "passed" : "signal strength"}</span><span>1.0</span></div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function FeedPanel() {
  const showingSignals = signalPosts.length > 0;
  const items = showingSignals ? signalPosts.slice(0, 12) : latestPosts.slice(0, 8);
  return (
    <section aria-labelledby="feed-title">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">{showingSignals ? `Actionable calls · last ${WINDOW_HOURS}h` : "Latest posts · no actionable call yet"}</p>
          <h2 id="feed-title">Event Feed</h2>
        </div>
        <span className="streaming"><i className="live-dot" /> {pipelineStats.sponsoredInWindow ? `${pipelineStats.sponsoredInWindow} sponsored filtered` : "streaming"}</span>
      </div>
      {items.length === 0 ? (
        <p className="ledger-empty mono-font">The agent has not ingested any posts yet. Run the agent loop and reload.</p>
      ) : (
        <div className="feed-list">
          {items.map((post) => {
            const signal = "signal" in post ? (post as (typeof signalPosts)[number]).signal : null;
            const isEcho = Boolean(signal?.is_echo);
            const text = decodeEntities(post.text);
            return (
              <a className={`feed-item${isEcho ? " echo" : ""}`} key={post.id} href={post.url} target="_blank" rel="noreferrer" aria-label={`Open original post by ${post.handle}`}>
                <div className="feed-line" aria-hidden="true"><i /></div>
                <div className="feed-content">
                  <div className="feed-meta">
                    <strong>{post.handle.startsWith("@") ? post.handle : `@${post.handle}`}</strong>
                    <span className="platform">{post.platform}</span>
                    <time dateTime={post.posted_at}>{relativeTime(post.posted_at)}</time>
                  </div>
                  <p>“{text.length > 240 ? `${text.slice(0, 240)}…` : text}”</p>
                  <div className="feed-tags">
                    {signal ? (
                      <>
                        <span className="token-tag">{signal.token}</span>
                        <span className={`sentiment ${sentimentClass(signal.sentiment)}`}>{signal.sentiment}</span>
                        <span className="token-tag">conviction {signal.conviction.toFixed(1)}</span>
                        {isEcho && <span className="echo-tag">↳ Echo{signal.echo_of ? ` of ${signal.echo_of}` : " detected"}</span>}
                      </>
                    ) : (
                      <span className="muted-state">no actionable call</span>
                    )}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Radar() {
  const latest = heroCards[0]?.card;
  return (
    <SiteLayout active="radar">
      <section className="hero">
        <EclipseOrb className="hero__orb" />
        <div className="hero__grid">
          <div>
            <p className="eyebrow fade-up">Accountable AI · evidence on Ethereum Sepolia</p>
            <h1 className="display-font fade-up" style={{ ["--d" as string]: "80ms" }}>
              Filter the echo.
              <br />
              Record the <span className="accent-underline">signal</span>
            </h1>
            <p className="mono-font hero__lead fade-up" style={{ ["--d" as string]: "160ms" }}>
              An AI agent that decides as if it will be cross-examined. It discounts claims that are only repeated, argues both sides, and leaves an
              evidence-grade record on-chain that anyone can replay.
            </p>
            <div className="fade-up" style={{ ["--d" as string]: "200ms" }}>
              <ProofStrip />
            </div>
            <div className="hero__actions fade-up" style={{ ["--d" as string]: "240ms" }}>
              {latest && (
                <a className="ec-button" href={`/card/${encodeURIComponent(latest.card_id)}`}>
                  Open latest card <span aria-hidden="true">→</span>
                </a>
              )}
              <a className="ghost-button" href="/scorecard">View scorecard</a>
            </div>
            <div className="hero__funnel fade-up" style={{ ["--d" as string]: "320ms" }}>
              <DecisionFunnel />
            </div>
          </div>
          <div className="fade-up hero__panel-wrap" style={{ ["--d" as string]: "200ms" }}>
            <LatestCards />
          </div>
        </div>
      </section>

      <SignalTicker />

      <section className="page-section" id="radar" aria-labelledby="radar-title">
        <Reveal>
          <div className="section-heading-row">
            <SectionHeading id="radar-title" eyebrow="Live radar · agent output" title="Independent voices, measured before the market moves" />
            <div className="scan-status" aria-label="Live scan status">
              <span className="live-dot" aria-hidden="true" />
              <span className="mono-font">{snapshotTime ? `Last post ${formatUtc(snapshotTime)}` : "Waiting for the first ingest"}</span>
            </div>
          </div>
        </Reveal>

        <div className="dashboard-grid">
          <Reveal className="panel graph-panel"><EchoGraph /></Reveal>
          <Reveal className="panel watchlist-panel" delay={60}><WatchlistPanel /></Reveal>
          <Reveal className="panel convergence-panel" delay={90}><ConvergencePanel /></Reveal>
          <Reveal className="panel feed-panel" delay={120}><FeedPanel /></Reveal>
        </div>
      </section>

      <CreFlow />

      <OnChainLedger />

      <ComplianceMap />

      <BuildOnRecord />

      <HowItWorks />
    </SiteLayout>
  );
}

function App() {
  if (typeof window !== "undefined" && /^\/scorecard\/?$/.test(window.location.pathname)) {
    return <Scorecard />;
  }

  if (typeof window !== "undefined" && /^\/casefile\/?$/.test(window.location.pathname)) return <CaseFilePage />;
  if (typeof window !== "undefined" && /^\/ryo\/?$/.test(window.location.pathname)) return <RyoPage />;
  if (typeof window !== "undefined" && /^\/judge\/?$/.test(window.location.pathname)) return <JudgePage />;

  const recordRoute = typeof window === "undefined" ? null : window.location.pathname.match(/^\/record\/(0x[0-9a-fA-F]{8,64})\/?$/);
  if (recordRoute) return <CertificatePage positionId={recordRoute[1]} />;

  const cardRoute = typeof window === "undefined" ? null : window.location.pathname.match(/^\/card\/([^/]+)\/?$/);
  if (cardRoute) {
    const cardId = decodeURIComponent(cardRoute[1]);
    const card = [...draftCards, ...exampleCards].find((candidate) => candidate.card_id === cardId);
    return card ? <ReasoningCardDetail card={card} fixture={exampleCards.some((example) => example.card_id === card.card_id)} /> : <CardNotFound cardId={cardId} />;
  }

  return <Radar />;
}

export default App;
