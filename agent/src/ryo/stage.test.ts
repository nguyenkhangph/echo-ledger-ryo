import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RyoClient } from "./client";
import { replayRun, runRyoStage } from "./stage";

// Shapes follow the public envelope in the RYO Builder MCP Guide; field names inside `data` are test inputs only.
const envelope = (tool: string, data: unknown, status = "ok", data_mode = "live") => ({ result: { schema_version: "1", tool, status, data_mode, as_of: "2026-11-11T00:00:00Z", request: {}, data, summary: { headline: "x" }, availability: {}, warnings: [] } });

function fakeRyo(opts: { down?: string[]; disabled?: boolean } = {}) {
  return (async (url: string, init: RequestInit) => {
    const tool = String(url).split("/tools/")[1]?.split("/")[0] ?? "";
    const args = JSON.parse(String(init.body ?? "{}"));
    if (opts.disabled) return new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "MCP call allowance exhausted." } }), { status: 429, headers: { "Retry-After": "1872000" } });
    if (opts.down?.includes(tool)) return new Response("{}", { status: 503, headers: { "Retry-After": "0" } });
    const body =
      tool === "market_overview" ? envelope(tool, { regime: "neutral", fear_greed: 55 })
      : tool === "monitor_market_sentiment_shift" ? envelope(tool, { combined_regime: "neutral" })
      : tool === "scan_market" ? envelope(tool, { candidates: [{ symbol: "SOL" }, { symbol: "BTC" }] })
      : tool === "deep_analysis" ? envelope(tool, { market: { price: args.symbol === "SOL" ? 150 : 90000, change_24h: 3 }, technicals: { rsi_14: 55, atr_14: args.symbol === "SOL" ? 6 : 2000 }, verdict: "bullish", risks: [{ title: "volatility", severity: "medium" }] })
      : tool === "compare_tokens" ? envelope(tool, { tokens: String(args.symbols).split(/[ ,]+/).filter(Boolean).map((s, i) => ({ symbol: s, score: 70 - i * 5 })) })
      : { error: { code: "unknown_tool" } };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

function candidates() {
  const dir = mkdtempSync(join(tmpdir(), "ryo-"));
  const file = join(dir, "c.jsonl");
  const src = (h: string, s: string, echo = false) => ({ post_id: `t:${h}`, handle: h, sentiment: s, conviction: 0.6, is_echo: echo, echo_of: echo ? "a" : null, reasoning_summary: "" });
  writeFileSync(file, [
    { token: "SOL", window_h: 24, sources: [src("a", "bullish"), src("b", "bullish"), src("c", "bullish"), src("d", "bullish", true)] },
    { token: "PEPE", window_h: 24, sources: [src("x", "bullish", true)] },
  ].map((c) => JSON.stringify(c)).join("\n"));
  return { dir, file };
}

const cfg = { url: "https://ryo.test/api/mcp", key: "k_test_123456", perMinute: 1000, timeoutMs: 2000, maxAttempts: 2 };
const quiet = () => {};

describe("RYO stage", () => {
  test("combines six tools into a cited decision and replays it without calling RYO", async () => {
    const { dir, file } = candidates();
    const run = await runRyoStage({ candidatesFile: file, outDir: dir, client: new RyoClient(cfg, fakeRyo()), log: quiet });
    expect(run.calls.map((c) => c.tool)).toEqual(["market_overview", "monitor_market_sentiment_shift", "scan_market", "deep_analysis", "compare_tokens"]);
    expect(run.skipped).toEqual([{ token: "PEPE", reason: "only echoes: no independent voice, RYO not called" }]);
    const sol = run.narratives[0]!;
    expect(sol.decision.verdict).toBe("OPEN");
    expect(sol.decision.plan!.entry).toBe(150);
    expect(sol.decision.plan!.stopPct).toBe(6); // 1.5 × ATR 6 / 150
    expect(sol.claims.every((c) => c.kept)).toBe(true);
    expect(run.scan.mentions.find((m) => m.symbol === "SOL")!.independent).toEqual(["a", "b", "c"]);
    expect(replayRun(run).every((r) => r.same)).toBe(true);
  });

  test("a disabled key or a dead tool never produces numbers", async () => {
    const { dir, file } = candidates();
    const off = await runRyoStage({ candidatesFile: file, outDir: dir, client: new RyoClient(cfg, fakeRyo({ disabled: true })), log: quiet });
    expect(off.narratives[0]!.decision.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(off.narratives[0]!.decision.plan).toBeNull();
    expect(off.evidence.every((e) => e.status === "unavailable")).toBe(true);
    const down = await runRyoStage({ candidatesFile: file, outDir: dir, client: new RyoClient(cfg, fakeRyo({ down: ["deep_analysis"] })), log: quiet });
    expect(down.narratives[0]!.decision.verdict).toBe("INSUFFICIENT_EVIDENCE");
  });
});
