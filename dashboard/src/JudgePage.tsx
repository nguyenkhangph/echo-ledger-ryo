import { SiteLayout } from "./components/SiteChrome";
import { latestRyoRun } from "./data/ryo";

type Row = { weight: string; name: string; what: string; href: string; link: string; cmd?: string };

const REPO = "https://github.com/nguyenkhangph/echo-ledger-ryo";

const SHARED: Row[] = [
  { weight: "20%", name: "Combining sources", what: "KOL posts from many accounts are folded for echoes, then checked against all six RYO tools: market_overview, monitor_market_sentiment_shift, scan_market, deep_analysis, analyze_token (cross-check: the two must agree on direction and price within 1%) and compare_tokens (token vs BTC vs a peer). Each gate on a card cites the RYO evidence id it used.", href: "/ryo", link: "RYO check: gates and evidence chips" },
  { weight: "20%", name: "Coping with failure", what: "Every RYO response is kept, including refusals. partial, unavailable, mixed or simulated data is never used as a live number; a token RYO does not cover is marked not analysable; retries back off with jitter and honour Retry-After; if deep_analysis is down, analyze_token still reads price and direction, but with no RYO risk list the agent records Missing evidence instead of opening blind; a disabled key leads to 'Missing evidence', not estimates.", href: "/ryo", link: "Evidence ledger at the bottom of RYO check", cmd: "bun test agent/src/ryo  ·  bun run ryo:eval" },
];
const TRACK1: Row[] = [
  { weight: "25%", name: "Real thinking", what: "KOL claims are treated as claims: each voice is marked corroborated, unconfirmed or contradicted by RYO. A crowd calling up while RYO reads down is rejected in public. Debate claims whose number does not match the RYO payload are removed with the reason.", href: "/ryo", link: "Voices, contradiction cards, claims" },
  { weight: "20%", name: "Cause and effect", what: "What-if buttons on each card: count echoes, drop one KOL, ignore RYO vetoes, deep_analysis or analyze_token down. Before and after are shown side by side, and the naive bot sits next to Echo Ledger + RYO. `ryo:recheck` calls deep_analysis again and records the before/after on the card.", href: "/ryo", link: "'What if…' row on each card" },
  { weight: "10%", name: "Repeatability", what: "Decisions are pure functions of stored evidence. 'Replay this run' recomputes every decision in the browser with the same hash; the CLI does the same.", href: "/ryo", link: "Replay this run", cmd: "bun run ryo:replay" },
  { weight: "—", name: "Learning from results", what: "24 h after a run, `ryo:settle` reads RYO's price again, scores each KOL call right or wrong by direction and moves trust (+2.5 / −2.5, −2.5 more for an echo). The source validity table ranks sources by outcome, never by followers.", href: "/ryo", link: "Source validity table", cmd: "bun run ryo:settle" },
  { weight: "5%", name: "Advanced execution", what: "Practice entry, stop (1.5 × ATR(14), clamped 2–8%) and target (2R) are computed in code from RYO's live price; no model writes a level. Card hashes go on-chain through Chainlink CRE in the Echo Ledger contract on Sepolia.", href: "/#ledger", link: "On-chain ledger and certificates" },
];
const TRACK2: Row[] = [
  { weight: "25%", name: "Easy to read", what: "One headline per narrative in plain words, a coloured verdict, and the two-column naive vs Echo + RYO comparison.", href: "/ryo", link: "RYO check" },
  { weight: "25%", name: "Sorted by importance", what: "Verdict first, then the trade plan, then the gates that decided it, then voices and claims; raw payloads only on request.", href: "/ryo", link: "Any card" },
  { weight: "10%", name: "Works for everyone", what: "Keyboard-reachable controls, readable contrast, mobile layout, no wallet needed to read anything.", href: "/", link: "Dashboard" },
];

const TRACK3: Row[] = [
  { weight: "25%", name: "Fills a gap", what: "RYO measures the market; nothing in RYO measures whether the people talking about a token are independent. narrative_independence folds declared reposts, near-duplicate texts and repeat posts into one voice and reports independent vs naive agreement, echo clusters and pivotal voices. stale_call measures how stale a call is against RYO's live state (age, move already made vs ATR, RSI).", href: "/ryo", link: "Skill lines under each card's voices" },
  { weight: "15%", name: "Follows the spec", what: "Both skills return RYO's public envelope exactly (schema_version, tool, status ok/partial/unavailable, data_mode, as_of, request, data, summary, availability, warnings), with nulls never turned into zeros, and are served like RYO: GET /tools, POST /tools/{name}/call, MCP tools/list and tools/call.", href: "https://github.com/nguyenkhangph/echo-ledger-ryo/tree/main/shared/src/ryo/skills", link: "shared/src/ryo/skills", cmd: "bun run skills:serve" },
  { weight: "20%", name: "Could we use it", what: "One command serves both skills; no key needed for narrative_independence; stale_call uses the server's RYO key and degrades to an age-only, partial result without one. Tests cover the envelope shape and every degraded path.", href: "https://github.com/nguyenkhangph/echo-ledger-ryo#ryo-chan-hackathon-2026-entry", link: "README: Track 3 skills", cmd: "bun test agent/src/skills shared/test/ryo-skills.test.ts" },
];

function Table({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="panel judge-sec">
      <h2>{title}</h2>
      <ul className="judge-list">
        {rows.map((r) => (
          <li key={r.name}>
            <span className="mono-font judge-w">{r.weight}</span>
            <div>
              <b>{r.name}</b>
              <p>{r.what}</p>
              <p className="mono-font">
                <a href={r.href}>→ {r.link}</a>
                {r.cmd && <span className="ryo-muted"> · {r.cmd}</span>}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function JudgePage() {
  const run = latestRyoRun;
  return (
    <SiteLayout active="judge">
      <div className="ryo-page">
        <p className="section-kicker">For judges · 30 seconds</p>
        <h1 className="ryo-title">Each criterion, and where to see it</h1>
        <p className="ryo-lead">
          Echo Ledger is a multi-KOL narrative agent (Track 1) with a judge-readable dashboard (Track 2) and two new research skills in RYO's tool format (Track 3). It decides whether a crypto narrative is
          independent agreement or an echo, and whether RYO-CHAN's live research backs it.
          {run ? ` Latest recorded run: ${new Date(run.startedAt).toUTCString().slice(5, 22)} UTC, ${run.quota.calls} RYO calls.` : " No RYO run has been recorded yet."}
        </p>
        <Table title="All tracks · 40 pts" rows={SHARED} />
        <Table title="Track 1 · Agents and strategy" rows={TRACK1} />
        <Table title="Track 2 · Dashboards and interfaces" rows={TRACK2} />
        <Table title="Track 3 · New skills" rows={TRACK3} />
        <p className="mono-font ryo-muted">
          Source: <a href="https://github.com/RYO-Digital/ryochan-hackathon_repository-427">github.com/RYO-Digital/ryochan-hackathon_repository-427</a> (mirror:{" "}
          <a href={REPO}>{REPO.replace("https://", "")}</a>) · run locally: <code>bun install && bun test && bun run ryo:eval</code>
        </p>
      </div>
    </SiteLayout>
  );
}
