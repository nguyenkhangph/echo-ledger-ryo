import { describe, expect, test } from "bun:test";
import { makeHandler } from "./server";

const h = makeHandler(null);
const post = (path: string, body: unknown) => h(new Request(`http://x${path}`, { method: "POST", body: JSON.stringify(body) }));

describe("skills server", () => {
  test("lists both skills with input schemas", async () => {
    const r = (await (await h(new Request("http://x/tools"))).json()) as { tools: Array<{ name: string; inputSchema: unknown }> };
    expect(r.tools.map((t) => t.name)).toEqual(["narrative_independence", "stale_call"]);
    expect(r.tools.every((t) => t.inputSchema)).toBe(true);
  });

  test("REST call returns {result: envelope}", async () => {
    const r = (await (await post("/tools/narrative_independence/call", { symbol: "SOL", posts: [{ id: "1", handle: "a", sentiment: "bullish" }, { id: "2", handle: "b", sentiment: "bullish" }] })).json()) as { result: { status: string; data: { independent: { passes: boolean } } } };
    expect(r.result.status).toBe("ok");
    expect(r.result.data.independent.passes).toBe(true);
  });

  test("stale_call without a RYO key degrades to age only", async () => {
    const r = (await (await post("/tools/stale_call/call", { symbol: "SOL", side: "long", posted_at: new Date(Date.now() - 3_600_000).toISOString() })).json()) as { result: { status: string; availability: Record<string, string> } };
    expect(r.result.status).toBe("partial");
    expect(r.result.availability.market_state).toBe("unavailable");
  });

  test("MCP tools/call returns the envelope as text; unknown tool is an error", async () => {
    const ok = (await (await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "narrative_independence", arguments: { symbol: "SOL", posts: [] } } })).json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(ok.result.isError).toBe(true);
    expect(JSON.parse(ok.result.content[0]!.text).status).toBe("unavailable");
    expect((await post("/tools/exit_liquidity/call", {})).status).toBe(404);
  });
});
