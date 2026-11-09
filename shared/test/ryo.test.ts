import { describe, expect, test } from "bun:test";
import { classifyStatus, decide, counterfactuals, EvidenceBook, factFrom, asNumber, verifyClaims, missing, type DecisionInput, type MarketFacts, type TokenFacts, type Voice } from "../src/ryo";

const at = "2026-11-09T12:00:00.000Z";
const v = (handle: string, sentiment: Voice["sentiment"], is_echo = false): Voice => ({ handle, sentiment, conviction: 0.6, is_echo });

function world(over: { risk?: string; dir?: string; phase?: string; vsBtc?: number; inCatalog?: boolean; status?: string; safety?: string } = {}) {
  const book = new EvidenceBook();
  const mo = book.add("market_overview", {}, { risk_level: over.risk ?? "low" }, at);
  const da = book.add("deep_analysis", { token: "SOL" }, { status: over.status ?? "ok", price: 150.25, change_24h: 4, trend: over.dir ?? "up", wave: over.phase ?? "early" }, at);
  const ct = book.add("compare_tokens", { tokens: ["SOL", "BTC", "AVAX"] }, { vs_btc: over.vsBtc ?? 1.5, vs_peer: 0.8 }, at);
  const cs = book.add("check_safety", { token: "SOL" }, { verdict: over.safety ?? "pass" }, at);
  const market: MarketFacts = { risk: factFrom(mo, "risk_level", (r) => (typeof r === "string" ? (r as "low") : undefined), "risk"), shift: missing("no monitor") };
  const s = (r: unknown) => (typeof r === "string" ? r : undefined);
  const facts: TokenFacts = {
    token: "SOL",
    inCatalog: over.inCatalog === false ? { ok: true, value: false, evidence: da.id, path: "" } : { ok: true, value: true, evidence: da.id, path: "" },
    price: factFrom(da, "price", asNumber, "price"),
    change24hPct: factFrom(da, "change_24h", asNumber, "24h"),
    direction: factFrom(da, "trend", s as (r: unknown) => "up" | undefined, "direction"),
    phase: factFrom(da, "wave", s as (r: unknown) => "early" | undefined, "phase"),
    safety: factFrom(cs, "verdict", s as (r: unknown) => "pass" | undefined, "safety"),
    vsBtcPct: factFrom(ct, "vs_btc", asNumber, "vs BTC"),
    vsPeerPct: factFrom(ct, "vs_peer", asNumber, "vs peer"),
    peer: "AVAX",
  };
  return { book, market, facts };
}

const voices = [v("a", "bullish"), v("b", "bullish"), v("c", "bearish"), v("d", "bullish", true)];
const input = (w = world()): DecisionInput => ({ token: "SOL", voices, market: w.market, facts: w.facts });

describe("evidence status", () => {
  test("partial, unavailable and simulated payloads are never live", () => {
    expect(classifyStatus({ status: "partial" }).status).toBe("partial");
    expect(classifyStatus({ meta: { mode: "simulated" } }).status).toBe("simulated");
    expect(classifyStatus({ error: "rate limited" }).status).toBe("unavailable");
    expect(classifyStatus({ price: 1 }, true).status).toBe("unavailable");
    expect(classifyStatus({ price: 1 }).status).toBe("live");
  });
});

describe("decide", () => {
  test("opens with levels computed from RYO's live price", () => {
    const d = decide(input());
    expect(d.verdict).toBe("OPEN");
    expect(d.plan).toEqual({ side: "LONG", entry: 150.25, stop: 145.7425, target: 159.265, stopPct: 3, sizeBps: 275, horizonH: 24, priceEvidence: "E2" });
  });

  test("same inputs, same decision, same hash (replay)", () => {
    expect(decide(input()).hash).toBe(decide(input()).hash);
    expect(decide(input()).hash).not.toBe(decide(input(world({ vsBtc: 1.6 }))).hash);
  });

  test("market risk high is a veto; medium raises the bar", () => {
    expect(decide(input(world({ risk: "high" }))).verdict).toBe("REJECT");
    const medium = decide(input(world({ risk: "medium" })));
    expect(medium.threshold).toBe(0.67);
    expect(medium.verdict).toBe("REJECT"); // 2 of 3 = 0.667 < 0.67
  });

  test("KOLs bullish, RYO says down: public contradiction", () => {
    const d = decide(input(world({ dir: "down" })));
    expect(d.verdict).toBe("REJECT");
    expect(d.headline).toContain("rejected in public");
    expect(d.voices.find((x) => x.handle === "a")!.ryo).toBe("contradicted");
  });

  test("late call, weaker than BTC, failed safety: each blocks", () => {
    expect(decide(input(world({ phase: "late" }))).verdict).toBe("REJECT");
    expect(decide(input(world({ vsBtc: -2 }))).verdict).toBe("REJECT");
    expect(decide(input(world({ safety: "fail" }))).verdict).toBe("REJECT");
  });

  test("outside the catalog: not analysed, nothing invented", () => {
    const d = decide(input(world({ inCatalog: false })));
    expect(d.verdict).toBe("NOT_ANALYZABLE");
    expect(d.plan).toBeNull();
  });

  test("simulated RYO data is treated as missing, not as live", () => {
    const d = decide(input(world({ status: "simulated" })));
    expect(d.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(d.missing.join(" ")).toContain("simulated");
  });

  test("counterfactuals: echoes, dropping a voice, ignoring RYO vetoes", () => {
    const cf = counterfactuals(input(world({ dir: "down" })));
    expect(cf.actual.verdict).toBe("REJECT");
    expect(cf.withoutRyoVetoes.verdict).toBe("OPEN");
    expect(cf.naive.score).toBeCloseTo(0.75);
    expect(cf.withoutEach.find((x) => x.handle === "a")!.decision.score).toBe(0.5);
  });
});

describe("claims", () => {
  test("a number that does not match the payload is removed with the reason", () => {
    const { book } = world();
    const checked = verifyClaims(
      [
        { by: "bull", text: "SOL trades at 150.2", evidence: ["E2"], path: "price", value: 150.2 },
        { by: "bear", text: "SOL is at 140", evidence: ["E2"], path: "price", value: 140 },
        { by: "bull", text: "Everyone is buying", evidence: [] },
      ],
      book,
    );
    expect(checked.map((c) => c.kept)).toEqual([true, false, false]);
    expect(checked[1]!.reason).toBe("says 140, E2.price is 150.25");
  });
});
