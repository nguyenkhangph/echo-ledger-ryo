import type { EvidenceBook, RyoEvidence } from "./evidence";
import { asNumber, missing, type Direction, type Fact, type MarketFacts, type MarketRisk, type TokenFacts, type WavePhase } from "./facts";

/**
 * Turns RYO result envelopes into the facts the rules use. Fields are located by name inside `data` (never in
 * `summary`, which RYO says is for display), and every fact records the exact path it came from, so a reader can
 * open the payload and find the number. Anything not found is reported missing; nothing is defaulted or set to zero.
 *
 * Derived facts use fixed, published rules:
 *  - direction: from RYO's own verdict/trend wording (bullish/up/long → up, bearish/down/short → down, else flat);
 *  - wave phase: RSI(14) ≥ 75 (or ≤ 25 for a short) is "late", 60–75 "mid", otherwise "early";
 *  - market risk: an explicit RYO risk/regime field if present; otherwise Fear & Greed ≥ 80 or ≤ 20 is high,
 *    ≥ 65 or ≤ 35 is medium, else low.
 */

type Found = { value: unknown; path: string };

/** Depth-first search for the first key whose name matches, inside `data`. Arrays are searched too. */
export function findKey(root: unknown, patterns: RegExp[], base = "data", depth = 0): Found | null {
  if (root == null || typeof root !== "object" || depth > 6) return null;
  const entries = Array.isArray(root) ? root.map((v, i) => [`[${i}]`, v] as const) : Object.entries(root as Record<string, unknown>).map(([k, v]) => [k, v] as const);
  for (const pattern of patterns) {
    for (const [k, v] of entries) {
      if (!k.startsWith("[") && pattern.test(k) && v != null && typeof v !== "object") return { value: v, path: `${base}.${k}` };
    }
  }
  for (const [k, v] of entries) {
    if (v && typeof v === "object") {
      const hit = findKey(v, patterns, k.startsWith("[") ? `${base}${k}` : `${base}.${k}`, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

const dataOf = (e: RyoEvidence) => (e.payload as Record<string, unknown> | null)?.data;

function fact<T>(e: RyoEvidence | undefined, label: string, patterns: RegExp[], convert: (raw: unknown) => T | undefined): Fact<T> {
  if (!e) return missing(`${label}: not requested`);
  if (e.status !== "live") return missing(`${label}: ${e.id} is ${e.status}${e.statusReason ? ` (${e.statusReason})` : ""}`, e.id);
  const hit = findKey(dataOf(e), patterns);
  if (!hit) return missing(`${label}: no matching field in ${e.id}.data`, e.id);
  const value = convert(hit.value);
  if (value === undefined) return missing(`${label}: ${e.id}.${hit.path} is not usable (${String(hit.value).slice(0, 40)})`, e.id);
  return { ok: true, value, evidence: e.id, path: hit.path };
}

export const toDirection = (raw: unknown): Direction | undefined => {
  if (typeof raw !== "string") return undefined;
  const s = raw.toLowerCase();
  if (/bull|up|long|buy|accumulat|positive|strong/.test(s)) return "up";
  if (/bear|down|short|sell|distribut|negative|weak/.test(s)) return "down";
  if (/neutral|flat|hold|range|mixed|sideways|wait/.test(s)) return "flat";
  return undefined;
};

export const toRisk = (raw: unknown): MarketRisk | undefined => {
  if (typeof raw === "string") {
    const s = raw.toLowerCase();
    if (/extreme|high|risk[-_ ]?off|panic|capitulat|euphori/.test(s)) return "high";
    if (/elevated|medium|moderate|caution|neutral[-_ ]?bear|choppy|volatile/.test(s)) return "medium";
    if (/low|risk[-_ ]?on|calm|healthy|stable|neutral|bull/.test(s)) return "low";
    return undefined;
  }
  const n = asNumber(raw);
  if (n === undefined) return undefined;
  if (n >= 80 || n <= 20) return "high";
  if (n >= 65 || n <= 35) return "medium";
  return "low";
};

const RE = {
  price: [/^(price|price_usd|current_price|usd_price|last_price)$/i, /price/i],
  change24h: [/^(change_24h|price_change_24h|change_24h_pct|percent_change_24h|pct_change_24h|change_pct_24h|24h)$/i, /24h/i],
  verdict: [/^(verdict|bias|direction|trend|stance|signal|outlook)$/i, /verdict|bias|trend/i],
  rsi: [/^rsi(_?14)?$/i, /rsi/i],
  atr: [/^atr(_?14)?$/i, /^atr/i],
  risk: [/^(risk_level|risk|risk_regime|regime|market_regime)$/i],
  fearGreed: [/^(fear_greed|fear_and_greed|fear_greed_index|fng|fear_greed_value)$/i, /fear/i],
  shift: [/^(sentiment_regime|combined_regime|regime|shift|direction|phase)$/i, /regime|shift/i],
  symbol: [/^(symbol|token|asset|ticker)$/i],
  score: [/^(score|composite_score|total_score|momentum_score|momentum|rank_score)$/i, /score/i],
};

export function marketFacts(overview: RyoEvidence | undefined, sentiment: RyoEvidence | undefined): MarketFacts {
  let risk = fact<MarketRisk>(overview, "market risk", RE.risk, toRisk);
  if (!risk.ok) {
    const fg = fact<MarketRisk>(overview, "market risk (Fear & Greed)", RE.fearGreed, toRisk);
    if (fg.ok) risk = fg;
  }
  const shiftRaw = fact<string>(sentiment, "sentiment shift", RE.shift, (r) => (typeof r === "string" ? r : undefined));
  const shiftValue = (raw: string): "none" | "bullish" | "bearish" => (toDirection(raw) === "up" ? "bullish" : toDirection(raw) === "down" ? "bearish" : "none");
  const shift: MarketFacts["shift"] = shiftRaw.ok ? { ok: true, value: shiftValue(shiftRaw.value), evidence: shiftRaw.evidence, path: shiftRaw.path } : shiftRaw;
  return { risk, shift };
}

const UNKNOWN_SYMBOL = /unknown|not (found|supported|listed)|unsupported|invalid symbol|no (data|market) for/i;

/** Per-token score from a compare_tokens payload: finds the list of tokens and a numeric score for each. */
export function compareScores(e: RyoEvidence | undefined): { scores: Record<string, { score: number; path: string }>; id: string | null } {
  const out: Record<string, { score: number; path: string }> = {};
  if (!e || e.status !== "live") return { scores: out, id: e?.id ?? null };
  const walk = (node: unknown, path: string, depth: number) => {
    if (!node || typeof node !== "object" || depth > 5) return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => {
        const sym = findKey(item, RE.symbol, `${path}[${i}]`);
        const sc = findKey(item, RE.score, `${path}[${i}]`);
        const n = sc ? asNumber(sc.value) : undefined;
        if (sym && typeof sym.value === "string" && n !== undefined) out[sym.value.toUpperCase()] ??= { score: n, path: sc!.path };
        else walk(item, `${path}[${i}]`, depth + 1);
      });
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (v && typeof v === "object" && !Array.isArray(v) && /^[A-Z0-9]{2,10}$/.test(k)) {
        const sc = findKey(v, RE.score, `${path}.${k}`);
        const n = sc ? asNumber(sc.value) : undefined;
        if (n !== undefined) out[k] ??= { score: n, path: sc!.path };
      }
      walk(v, `${path}.${k}`, depth + 1);
    }
  };
  walk(dataOf(e), "data", 0);
  return { scores: out, id: e.id };
}

export function tokenFacts(token: string, deep: RyoEvidence | undefined, compare: RyoEvidence | undefined, peer: string | null, sideHint: "LONG" | "SHORT" | "NONE"): TokenFacts {
  const T = token.toUpperCase();
  const deepError = deep && deep.status === "unavailable" ? String((deep.payload as Record<string, unknown> | null)?.error ?? deep.statusReason ?? "") : "";
  const inCatalog: Fact<boolean> =
    deep && deep.status === "unavailable" && UNKNOWN_SYMBOL.test(deepError)
      ? { ok: true, value: false, evidence: deep.id, path: "error" }
      : deep
        ? { ok: true, value: true, evidence: deep.id, path: "request.symbol" }
        : missing("catalog: deep_analysis not requested");

  const price = fact<number>(deep, "price", RE.price, (r) => {
    const n = asNumber(r);
    return n !== undefined && n > 0 ? n : undefined;
  });
  const change24hPct = fact<number>(deep, "24h change", RE.change24h, asNumber);
  const direction = fact<Direction>(deep, "direction", RE.verdict, toDirection);
  const rsi = fact<number>(deep, "RSI(14)", RE.rsi, asNumber);
  const phase: Fact<WavePhase> = rsi.ok
    ? {
        ...rsi,
        value: ((v: number): WavePhase => {
          const x = sideHint === "SHORT" ? 100 - v : v;
          return x >= 75 ? "late" : x >= 60 ? "mid" : "early";
        })(rsi.value),
      }
    : rsi;
  const atr = fact<number>(deep, "ATR(14)", RE.atr, (r) => {
    const n = asNumber(r);
    return n !== undefined && n > 0 ? n : undefined;
  });

  // Risks listed by deep_analysis stand in for a safety tool (RYO publishes none): any high/critical risk fails.
  const risksNode = deep && deep.status === "live" ? findArray(dataOf(deep), /risk/i, "data") : null;
  const risks = risksNode ? risksNode.items.map((r) => (typeof r === "string" ? r : String((r as Record<string, unknown>)?.title ?? (r as Record<string, unknown>)?.description ?? (r as Record<string, unknown>)?.label ?? JSON.stringify(r)))) : [];
  const severe = risksNode ? risksNode.items.some((r) => /high|critical|severe/i.test(JSON.stringify((r as Record<string, unknown>)?.severity ?? (r as Record<string, unknown>)?.level ?? ""))) : false;
  const safety: TokenFacts["safety"] = risksNode && deep ? { ok: true, value: severe ? "fail" : risks.length ? "warn" : "pass", evidence: deep.id, path: risksNode.path } : missing("safety: no risk section in deep_analysis");

  const cmp = compareScores(compare);
  const mine = cmp.scores[T];
  const btc = cmp.scores.BTC;
  const peerScore = peer ? cmp.scores[peer.toUpperCase()] : undefined;
  const vsBtcPct: Fact<number> =
    T === "BTC" ? { ok: true, value: 0, evidence: (compare?.id ?? deep?.id ?? "E0") as `E${number}`, path: "(BTC is the benchmark)" }
    : mine && btc && compare ? { ok: true, value: mine.score - btc.score, evidence: compare.id, path: `${mine.path} − ${btc.path}` }
    : missing(compare ? `vs BTC: ${compare.id} has no comparable score for ${T} and BTC` : "vs BTC: compare_tokens not requested", compare?.id);
  const vsPeerPct: Fact<number> =
    mine && peerScore && compare ? { ok: true, value: mine.score - peerScore.score, evidence: compare.id, path: `${mine.path} − ${peerScore.path}` } : missing("vs peer: not available", compare?.id);

  return { token: T, inCatalog, price, change24hPct, direction, phase, safety, vsBtcPct, vsPeerPct, peer, atr, risks };
}

function findArray(root: unknown, name: RegExp, base: string, depth = 0): { items: unknown[]; path: string } | null {
  if (!root || typeof root !== "object" || depth > 5) return null;
  for (const [k, v] of Object.entries(root as Record<string, unknown>)) if (name.test(k) && Array.isArray(v)) return { items: v, path: `${base}.${k}` };
  for (const [k, v] of Object.entries(root as Record<string, unknown>)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const hit = findArray(v, name, `${base}.${k}`, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Peer used for the basket check: a same-sector large cap, fixed per token so runs are repeatable. */
export const PEERS: Record<string, string> = {
  BTC: "ETH", ETH: "SOL", SOL: "AVAX", AVAX: "SOL", BNB: "SOL", XRP: "ADA", ADA: "XRP", DOGE: "SHIB", SHIB: "DOGE",
  LINK: "UNI", UNI: "AAVE", AAVE: "UNI", ARB: "OP", OP: "ARB", SUI: "APT", APT: "SUI", TON: "TRX", TRX: "TON", NEAR: "SOL",
  CAKE: "UNI", HYPE: "SOL", WLD: "TAO", TAO: "WLD", PEPE: "DOGE", LTC: "BCH", BCH: "LTC", DOT: "ATOM", ATOM: "DOT",
};
export const peerOf = (token: string) => PEERS[token.toUpperCase()] ?? (token.toUpperCase() === "ETH" ? "SOL" : "ETH");

export type BookLike = Pick<EvidenceBook, "all">;
