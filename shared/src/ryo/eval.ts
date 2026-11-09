import { EvidenceBook, type RyoEvidence } from "./evidence";
import { asNumber, factFrom, missing, type MarketFacts, type TokenFacts } from "./facts";
import { decide, type DecisionInput, type Verdict, type Voice } from "./decision";
import { verifyClaims, type Claim } from "./claims";

/**
 * Evaluation set: hand-written situations with the verdict a careful analyst would reach. Each case builds RYO
 * evidence in the normalised shape the adapter produces, so the eval tests the rules, not the network.
 */
type World = {
  risk?: "low" | "medium" | "high" | null;
  shift?: "none" | "bullish" | "bearish";
  price?: number | null;
  change?: number;
  dir?: "up" | "down" | "flat";
  phase?: "early" | "mid" | "late";
  vsBtc?: number;
  vsPeer?: number;
  safety?: "pass" | "warn" | "fail" | null;
  inCatalog?: boolean;
  status?: "ok" | "partial" | "unavailable" | "simulated";
  toolDown?: boolean;
};

export type EvalCase = { id: string; title: string; voices: Voice[]; world: World; expect: Verdict; claims?: Claim[]; expectClaimsKept?: boolean[] };

const at = "2026-11-09T00:00:00.000Z";
const v = (handle: string, sentiment: Voice["sentiment"], is_echo = false): Voice => ({ handle, sentiment, conviction: 0.6, is_echo });
const s = <T extends string>(r: unknown) => (typeof r === "string" ? (r as T) : undefined);

export function buildWorld(token: string, w: World) {
  const book = new EvidenceBook();
  const mo = book.add("market_overview", {}, w.risk === null ? { status: "unavailable" } : { risk_level: w.risk ?? "low", sentiment_shift: w.shift ?? "none" }, at);
  const da: RyoEvidence = w.toolDown
    ? book.add("deep_analysis", { token }, null, at, true)
    : book.add("deep_analysis", { token }, { status: w.status ?? "ok", in_catalog: w.inCatalog ?? true, price: w.price === null ? undefined : w.price ?? 100, change_24h: w.change ?? 4, trend: w.dir ?? "up", wave: w.phase ?? "early" }, at);
  const ct = book.add("compare_tokens", { tokens: [token, "BTC", "PEER"] }, { vs_btc: w.vsBtc ?? 1, vs_peer: w.vsPeer ?? 0.5 }, at);
  const cs = w.safety === null ? undefined : book.add("check_safety", { token }, { verdict: w.safety ?? "pass" }, at);
  const market: MarketFacts = { risk: factFrom(mo, "risk_level", s<"low">, "market risk"), shift: factFrom(mo, "sentiment_shift", s<"none">, "sentiment shift") };
  const inCat = factFrom(da, "in_catalog", (r) => (typeof r === "boolean" ? r : undefined), "catalog");
  const facts: TokenFacts = {
    token,
    // An unreachable analysis tool says nothing about the catalog: treat as covered, then fail on missing data.
    inCatalog: inCat.ok ? inCat : { ok: true, value: true, evidence: da.id, path: "" },
    price: factFrom(da, "price", asNumber, "price"),
    change24hPct: factFrom(da, "change_24h", asNumber, "24h change"),
    direction: factFrom(da, "trend", s<"up">, "direction"),
    phase: factFrom(da, "wave", s<"early">, "wave phase"),
    safety: cs ? factFrom(cs, "verdict", s<"pass">, "safety") : missing("no safety tool"),
    vsBtcPct: factFrom(ct, "vs_btc", asNumber, "vs BTC"),
    vsPeerPct: factFrom(ct, "vs_peer", asNumber, "vs peer"),
    peer: "PEER",
  };
  return { book, input: { token, voices: [] as Voice[], market, facts } satisfies DecisionInput };
}

const three = [v("a", "bullish"), v("b", "bullish"), v("c", "bullish")];

export const EVAL_CASES: EvalCase[] = [
  { id: "clean-agree", title: "Three independent voices agree, RYO agrees", voices: three, world: {}, expect: "OPEN" },
  { id: "pure-echo", title: "One voice and four reposts of it", voices: [v("a", "bullish"), v("b", "bullish", true), v("c", "bullish", true), v("d", "bullish", true), v("e", "bullish", true)], world: {}, expect: "REJECT" },
  { id: "echo-majority", title: "Echoes make a minority look like a majority", voices: [v("a", "bullish"), v("b", "bearish"), v("c", "bullish", true), v("d", "bullish", true)], world: {}, expect: "REJECT" },
  { id: "split", title: "Independent sources disagree 2–2", voices: [v("a", "bullish"), v("b", "bullish"), v("c", "bearish"), v("d", "bearish")], world: {}, expect: "REJECT" },
  { id: "kol-vs-ryo", title: "KOLs call up, RYO's live trend is down", voices: three, world: { dir: "down" }, expect: "REJECT" },
  { id: "flat", title: "KOLs call up, RYO sees no direction", voices: three, world: { dir: "flat" }, expect: "REJECT" },
  { id: "risk-high", title: "Market overview flags high risk", voices: three, world: { risk: "high" }, expect: "REJECT" },
  { id: "risk-medium-edge", title: "Medium risk lifts the bar above 2 of 3", voices: [v("a", "bullish"), v("b", "bullish"), v("c", "bearish")], world: { risk: "medium" }, expect: "REJECT" },
  { id: "risk-medium-strong", title: "Medium risk, unanimous independent voices", voices: three, world: { risk: "medium" }, expect: "OPEN" },
  { id: "late", title: "The call arrives after the move", voices: three, world: { phase: "late" }, expect: "REJECT" },
  { id: "weak-vs-btc", title: "Token lags BTC", voices: three, world: { vsBtc: -3 }, expect: "REJECT" },
  { id: "weak-vs-peer", title: "Token lags its sector peer", voices: three, world: { vsPeer: -2 }, expect: "REJECT" },
  { id: "unsafe", title: "Safety check fails", voices: three, world: { safety: "fail" }, expect: "REJECT" },
  { id: "no-catalog", title: "Token outside RYO's catalog", voices: three, world: { inCatalog: false }, expect: "NOT_ANALYZABLE" },
  { id: "tool-down", title: "deep_analysis is unreachable", voices: three, world: { toolDown: true }, expect: "INSUFFICIENT_EVIDENCE" },
  { id: "partial", title: "deep_analysis returns partial data", voices: three, world: { status: "partial" }, expect: "INSUFFICIENT_EVIDENCE" },
  { id: "simulated", title: "deep_analysis returns simulated data", voices: three, world: { status: "simulated" }, expect: "INSUFFICIENT_EVIDENCE" },
  { id: "overview-down", title: "market_overview unavailable", voices: three, world: { risk: null }, expect: "INSUFFICIENT_EVIDENCE" },
  { id: "reversal", title: "Sentiment monitor flips bearish against a long", voices: three, world: { shift: "bearish" }, expect: "REJECT" },
  { id: "short", title: "Independent bearish call, RYO trend down, token weaker", voices: [v("a", "bearish"), v("b", "bearish"), v("c", "neutral")], world: { dir: "down", vsBtc: -2, vsPeer: -1 }, expect: "OPEN" },
  {
    id: "fabricated-number",
    title: "Debate quotes a price RYO never gave",
    voices: three,
    world: { price: 100 },
    expect: "OPEN",
    claims: [
      { by: "bull", text: "Price is 100", evidence: ["E2"], path: "price", value: 100 },
      { by: "bull", text: "Price is 120", evidence: ["E2"], path: "price", value: 120 },
      { by: "bear", text: "Volume collapsed", evidence: [] },
    ],
    expectClaimsKept: [true, false, false],
  },
];

export function runEval(cases: EvalCase[] = EVAL_CASES) {
  const rows = cases.map((c) => {
    const { book, input } = buildWorld("TKN", c.world);
    const decision = decide({ ...input, voices: c.voices });
    const checked = c.claims ? verifyClaims(c.claims, book) : [];
    const claimsOk = c.expectClaimsKept ? checked.every((x, i) => x.kept === c.expectClaimsKept![i]) : true;
    // An invented number is any price level not equal to RYO's live price in the evidence.
    const invented = decision.plan ? decision.plan.entry !== (input.facts.price.ok ? input.facts.price.value : NaN) : false;
    return { id: c.id, title: c.title, expected: c.expect, got: decision.verdict, correct: decision.verdict === c.expect && claimsOk, invented, headline: decision.headline, hash: decision.hash };
  });
  const correct = rows.filter((r) => r.correct).length;
  const invented = rows.filter((r) => r.invented).length;
  return { rows, total: rows.length, correct, accuracy: correct / rows.length, invented, inventedRate: invented / rows.length };
}
