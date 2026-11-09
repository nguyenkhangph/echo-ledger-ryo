import type { LedgerPosition } from "@echo/shared/ledger";
import { binanceSymbol, gapPct, klineUrl, useCandle } from "../data/corroboration";
import { decodeEntities, sourcePostsFor } from "../data/pipeline";
import { REPO_URL } from "../data/site";

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v < 1 ? 6 : 2 });
const minute = (iso: string) => new Date(Math.floor(Date.parse(iso) / 60_000) * 60_000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** One price on the ledger against Binance's own 1-minute candle for that minute. */
export function PriceCheck({ label, token, price, at }: { label: string; token: string; price: number; at: string }) {
  const state = useCandle(token, at);
  const url = klineUrl(token, at);
  let verdict: React.ReactNode = <span className="corr__pending">fetching Binance…</span>;
  if (state?.status === "ok") {
    const gap = gapPct(price, state.candle);
    verdict =
      gap === 0 ? (
        <span className="corr__ok">✓ inside Binance range {fmt(state.candle.low)}–{fmt(state.candle.high)}</span>
      ) : (
        <span className={gap < 1 ? "corr__ok" : "corr__bad"}>
          {gap < 1 ? "✓" : "✗"} {gap.toFixed(2)}% from Binance range {fmt(state.candle.low)}–{fmt(state.candle.high)}
        </span>
      );
  } else if (state?.status === "error") {
    verdict = <span className="corr__pending">open the Binance record to compare</span>;
  }
  return (
    <li className="corr__row">
      <span className="corr__what">{label}</span>
      <span className="corr__mono">{fmt(price)} USD · {minute(at)}</span>
      <span>{verdict}</span>
      <a className="corr__mono" href={url} target="_blank" rel="noreferrer">Binance {binanceSymbol(token)} 1m candle ↗</a>
    </li>
  );
}

/** Links to the original public posts behind a decision, taken from the agent's ingest log. */
export function SourcePosts({ position, max = 1 }: { position: LedgerPosition; max?: number }) {
  const want = position.side === "SHORT" ? "bearish" : "bullish";
  const rows = position.sources.map((source) => {
    const all = source.label ? sourcePostsFor(source.label, position.token, position.openedAt) : [];
    // Prefer the source's own independent call in the direction of the decision; fall back to whatever it posted.
    const rank = (p: (typeof all)[number]) => (p.signal.is_echo === source.echo ? 0 : 2) + (p.signal.sentiment === want ? 0 : 1);
    return { label: source.label ?? source.kolId.slice(0, 10), posts: [...all].sort((a, b) => rank(a) - rank(b)).slice(0, max) };
  });
  if (!rows.some((row) => row.posts.length)) return null;
  return (
    <>
    <h3>Original public posts about {position.token} before the decision</h3>
    <ul className="corr__posts">
      {rows.map((row) =>
        row.posts.map((post) => (
          <li key={post.id}>
            <span className="corr__what">{row.label}</span>
            <span className="corr__quote"><span className="corr__mono">{post.posted_at.slice(0, 16).replace("T", " ")} UTC</span> “{clip(decodeEntities(post.text).replace(/\s+/g, " "), 110)}”</span>
            <a className="corr__mono" href={post.url} target="_blank" rel="noreferrer">original post ↗</a>
          </li>
        )),
      )}
    </ul>
    </>
  );
}

export function Corroboration({ position }: { position: LedgerPosition }) {
  return (
    <div className="corr">
      <p className="corr__lead">
        Records kept by third parties, so the decision can be checked without trusting Ethereum, Chainlink or us.
      </p>
      <h3>Exchange prices</h3>
      <ul className="corr__list">
        <PriceCheck label={position.side === "NONE" ? "Price at decision" : "Entry price"} token={position.token} price={position.entryPrice} at={position.openedAt} />
        {position.exitPrice != null && position.settledAt && <PriceCheck label="Exit price" token={position.token} price={position.exitPrice} at={position.settledAt} />}
      </ul>
      <SourcePosts position={position} />
      <h3>Code and contract</h3>
      <ul className="corr__list">
        <li className="corr__row corr__row--plain">
          <span className="corr__what">Contract source</span>
          <a className="corr__mono" href={`https://repo.sourcify.dev/11155111/${"0x88fd1895d9b4BD28Cf641281b9AA1eF787b8DAd0"}`} target="_blank" rel="noreferrer">Sourcify exact match ↗</a>
        </li>
        <li className="corr__row corr__row--plain">
          <span className="corr__what">Agent, workflows, verifier</span>
          <a className="corr__mono" href={REPO_URL} target="_blank" rel="noreferrer">{REPO_URL.replace("https://", "")} ↗</a>
        </li>
      </ul>
    </div>
  );
}
