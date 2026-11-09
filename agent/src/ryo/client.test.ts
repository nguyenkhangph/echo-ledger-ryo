import { describe, expect, test } from "bun:test";
import { RyoClient, unwrap } from "./client";

const env = { schema_version: "1", tool: "analyze_token", status: "ok", data_mode: "live", data: { price: 1 } };
const res = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const cfg = { url: "https://ryo.test/api/mcp", key: "ryo_mcp_secret_key", perMinute: 1000, timeoutMs: 5000, maxAttempts: 4 };

describe("RyoClient", () => {
  test("retries 429 honouring Retry-After, then succeeds", async () => {
    const replies = [res(429, { error: { code: "rate_limited" } }, { "Retry-After": "0" }), res(200, { result: env }, { "X-RateLimit-Remaining": "41" })];
    const seen: string[] = [];
    const client = new RyoClient(cfg, (async (url: string, init: RequestInit) => {
      seen.push(`${(init.headers as Record<string, string>).Authorization}`);
      return replies.shift()!;
    }) as unknown as typeof fetch);
    const r = await client.call("analyze_token", { symbol: "SOL" });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    expect(r.rateLimit.remaining).toBe(41);
    expect(seen[0]).toBe("Bearer ryo_mcp_secret_key");
  });

  test("does not retry invalid arguments and never leaks the key", async () => {
    let calls = 0;
    const client = new RyoClient(cfg, (async () => {
      calls++;
      return res(400, { error: { code: "invalid_arguments", message: "bad symbol for key ryo_mcp_secret_key" } });
    }) as unknown as typeof fetch);
    const r = await client.call("analyze_token", { symbol: "" });
    expect(calls).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("[REDACTED]");
    expect(r.error).not.toContain("ryo_mcp_secret_key");
  });

  test("a dependency that stays down returns a failed call instead of throwing", async () => {
    const client = new RyoClient({ ...cfg, maxAttempts: 2 }, (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch);
    const r = await client.call("market_overview");
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(2);
    expect(r.error).toContain("ECONNRESET");
  });
});

describe("unwrap", () => {
  test("REST envelope and MCP text content", () => {
    expect(unwrap({ result: env }, "rest").envelope).toEqual(env);
    expect(unwrap({ result: { content: [{ type: "text", text: JSON.stringify(env) }], isError: false } }, "jsonrpc").envelope).toEqual(env);
    expect(unwrap({ result: { content: [{ type: "text", text: "unknown symbol" }], isError: true } }, "jsonrpc")).toEqual({ envelope: null, isError: true, error: "unknown symbol" });
  });
});
