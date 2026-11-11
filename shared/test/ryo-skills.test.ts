import { describe, expect, test } from "bun:test";
import { EvidenceBook, narrativeIndependence, runEval, settleRun, sourceValidity, staleCall, type RyoRun } from "../src/ryo";

const env = (data: unknown, status = "ok", data_mode = "live") => ({ schema_version: "1", tool: "analyze_token", status, data_mode, as_of: "2026-11-11T00:00:00Z", request: {}, data, summary: { headline: "x", key_points: [] }, availability: {}, warnings: [] });
const SHAPE = ["schema_version", "tool", "status", "data_mode", "as_of", "request", "data", "summary", "availability", "warnings"];

describe("narrative_independence skill", () => {
  const posts = [
    { id: "p1", handle: "alpha", sentiment: "bullish" as const, posted_at: "2026-11-10T00:00:00Z", text: "SOL breaking out above 150, targets 180 next week" },
    { id: "p2", handle: "beta", sentiment: "bullish" as const, posted_at: "2026-11-10T01:00:00Z", echo_of: "p1" },
    { id: "p3", handle: "gamma", sentiment: "bullish" as const, posted_at: "2026-11-10T02:00:00Z", text: "SOL breaking out above 150 targets 180 next week!!" },
    { id: "p4", handle: "delta", sentiment: "bearish" as const, posted_at: "2026-11-10T03:00:00Z", text: "SOL looks heavy, funding too high" },
    { id: "p5", handle: "alpha", sentiment: "bullish" as const, posted_at: "2026-11-10T04:00:00Z", text: "still long SOL" },
  ];

  test("returns the RYO envelope shape", () => {
    const r = narrativeIndependence({ symbol: "sol", posts, as_of: "2026-11-11T00:00:00Z" });
    expect(Object.keys(r)).toEqual(SHAPE);
    expect(r.tool).toBe("narrative_independence");
    expect(r.status).toBe("ok");
  });

  test("folds declared echoes, near duplicates and repeat posts", () => {
    const d = narrativeIndependence({ symbol: "SOL", posts, as_of: "2026-11-11T00:00:00Z" }).data!;
    expect(d.originators).toEqual(["alpha", "delta"]);
    expect(d.independent.voices).toBe(2);
    expect(d.independent.passes).toBe(false); // 1 of 2 agree
    expect(d.naive.posts).toBe(5);
    expect(d.naive.passes).toBe(true); // 4 of 5 posts bullish: the echo illusion
    const how = d.clusters[0]!.echoes.map((e) => e.how).sort();
    expect(how).toEqual(["declared", "near_duplicate", "same_account"]);
  });

  test("missing input degrades, never invents", () => {
    expect(narrativeIndependence({ symbol: "SOL", posts: [] }).status).toBe("unavailable");
    const partial = narrativeIndependence({ symbol: "SOL", posts: [...posts, { id: "p6", handle: "eps", sentiment: null }] });
    expect(partial.status).toBe("partial");
    expect(partial.data!.excluded[0]!.post).toBe("p6");
  });

  test("medium market risk raises the bar", () => {
    const three = [0, 1, 2].map((i) => ({ id: `q${i}`, handle: `h${i}`, sentiment: (i === 2 ? "bearish" : "bullish") as "bullish" | "bearish" }));
    expect(narrativeIndependence({ symbol: "X", posts: three, market_risk: "low" }).data!.independent.passes).toBe(true);
    expect(narrativeIndependence({ symbol: "X", posts: three, market_risk: "medium" }).data!.independent.passes).toBe(false);
  });
});

describe("stale_call skill", () => {
  const ev = (data: unknown, status?: string) => new EvidenceBook().add("analyze_token", { symbol: "SOL" }, env(data, status), "2026-11-11T12:00:00Z");

  test("fresh call early in the move", () => {
    const r = staleCall({ symbol: "SOL", side: "long", posted_at: "2026-11-11T11:00:00Z" }, ev({ price: 150, change_24h: 0.5, rsi_14: 52, atr_14: 6 }));
    expect(Object.keys(r)).toEqual(SHAPE);
    expect(r.status).toBe("ok");
    expect(r.data!.label).toBe("fresh");
  });

  test("old call after the move is stale", () => {
    const r = staleCall({ symbol: "SOL", side: "long", posted_at: "2026-11-09T12:00:00Z" }, ev({ price: 150, change_24h: 9, rsi_14: 79, atr_14: 6 }));
    expect(r.data!.label).toBe("stale");
  });

  test("price already moved against the call", () => {
    const r = staleCall({ symbol: "SOL", side: "long", posted_at: "2026-11-11T10:00:00Z" }, ev({ price: 150, change_24h: -6, rsi_14: 35, atr_14: 6 }));
    expect(r.data!.label).toBe("invalidated");
  });

  test("no live RYO data: age only, partial, nulls not zeros", () => {
    const r = staleCall({ symbol: "SOL", side: "short", posted_at: "2026-11-11T10:00:00Z" }, ev({ price: 150 }, "unavailable"));
    expect(r.status).toBe("partial");
    expect(r.data!.components.move).toBeNull();
    expect(r.data!.components.phase).toBeNull();
    expect(staleCall({ symbol: "SOL", side: "up" as "long", posted_at: "x" }).status).toBe("unavailable");
  });
});

describe("settlement and source validity", () => {
  const book = new EvidenceBook();
  const deep = book.add("deep_analysis", { symbol: "SOL" }, env({ price: 100, change_24h: 2, verdict: "bullish", rsi_14: 50 }), "2026-11-10T00:00:00Z");
  const src = (handle: string, sentiment: "bullish" | "bearish", echo = false) => ({ post_id: `t:${handle}`, handle, sentiment, conviction: 0.6, is_echo: echo, echo_of: echo ? "a" : null, reasoning_summary: "" });
  const run = {
    runId: "r1",
    startedAt: "2026-11-10T00:00:00Z",
    evidence: [deep],
    narratives: [{ token: "SOL", peer: "AVAX", voices: [], sources: [src("a", "bullish"), src("b", "bearish"), src("c", "bullish", true)], decision: { verdict: "OPEN", plan: { side: "LONG" } }, cardHash: "0x01" }],
  } as unknown as RyoRun;
  const later = new EvidenceBook(1).add("analyze_token", { symbol: "SOL" }, env({ price: 104 }), "2026-11-11T01:00:00Z");

  test("scores calls by RYO price at the horizon, echo penalised", () => {
    const s = settleRun(run, () => later, "2026-11-11T01:00:00Z");
    const n = s.narratives[0]!;
    expect(n.settled).toBe(true);
    if (!n.settled) return;
    expect(n.move_pct).toBe(4);
    expect(n.practice_pnl_bps).toBe(400);
    expect(n.price_now_evidence).toBe("E2");
    expect(n.calls.map((c) => [c.handle, c.result, c.trust_delta])).toEqual([["a", "right", 2.5], ["b", "wrong", -2.5], ["c", "right", 0]]);
    const table = sourceValidity([s]);
    expect(table[0]!.handle).toBe("a");
    expect(table.find((r) => r.handle === "c")!.echoes).toBe(1);
  });

  test("not settled before the horizon or without a live price", () => {
    expect(settleRun(run, () => later, "2026-11-10T10:00:00Z").narratives[0]!.settled).toBe(false);
    const dead = new EvidenceBook(1).add("analyze_token", { symbol: "SOL" }, null, "2026-11-11T01:00:00Z", true);
    const n = settleRun(run, () => dead, "2026-11-11T01:00:00Z").narratives[0]!;
    expect(n.settled).toBe(false);
  });
});

describe("eval set", () => {
  test("all cases correct, no invented numbers", () => {
    const r = runEval();
    expect(r.total).toBeGreaterThanOrEqual(26);
    expect(r.rows.filter((x) => !x.correct).map((x) => `${x.id}: got ${x.got}`)).toEqual([]);
    expect(r.invented).toBe(0);
  });
});
