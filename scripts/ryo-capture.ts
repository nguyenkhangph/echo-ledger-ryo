// Reads the live RYO catalog and makes one sample call of each tool, saving the real responses so Echo Ledger is
// wired to what the server actually returns. The key comes from the environment and is redacted from every file.
//   PowerShell:  $env:RYO_MCP_KEY="..."; bun run ryo:capture
import { mkdirSync, writeFileSync } from "node:fs";
import { RyoClient, redact } from "../agent/src/ryo/client";

// Capture is a one-off probe: shorter timeout and fewer retries than the agent, with progress on every attempt.
process.env.RYO_TIMEOUT_MS ||= "45000";
process.env.RYO_MAX_ATTEMPTS ||= "2";
const client = new RyoClient();
client.onAttempt = (e) =>
  console.log(
    e.phase === "start"
      ? `  … ${e.tool} attempt ${e.attempt} via ${e.via} (waiting up to ${client.config.timeoutMs / 1000}s)`
      : `  ← ${e.tool} attempt ${e.attempt}: ${e.status ?? "no response"} in ${((e.ms ?? 0) / 1000).toFixed(1)}s${e.error ? ` (${e.error})` : ""}`,
  );
if (!client.config.key) {
  console.error("Set RYO_MCP_KEY first (it is never written to disk).");
  process.exit(1);
}
const save = (path: string, value: unknown) => {
  mkdirSync(path.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(path, redact(JSON.stringify(value, null, 2), client.config) + "\n");
};

const health = await client.health().catch((e) => ({ error: String(e) }));
console.log("health:", JSON.stringify(health));
const who: any = await client.whoami().catch((e) => ({ error: String(e) }));
// Keep only non-secret fields from whoami.
const whoSafe = { label: who?.label, scope: who?.scope, expires_at: who?.expires_at ?? who?.expiresAt, quota: who?.quota, tools: who?.tools ?? who?.tool_names, error: who?.error };
console.log("whoami:", JSON.stringify(whoSafe));
console.log("reading catalog …");
const tools: any = await client.tools();
save("fixtures/ryo/tools.json", { listedAt: new Date().toISOString(), endpoint: client.config.url, health, tools });
const names: string[] = (tools?.tools ?? tools ?? []).map((t: any) => t.name);
console.log(`catalog: ${names.join(", ")}`);

const samples: Array<[string, Record<string, unknown>]> = [
  ["market_overview", {}],
  ["scan_market", { top_n: 5 }],
  ["analyze_token", { symbol: "SOL" }],
  ["deep_analysis", { symbol: "BTC", include_perp: true }],
  ["compare_tokens", { symbols: "SOL, BTC, ETH", intent: "swing" }],
  ["monitor_market_sentiment_shift", {}],
  ["analyze_token", { symbol: "NOTAREALTOKEN123" }],
];
for (const [tool, args] of samples) {
  if (!names.includes(tool)) {
    console.log(`skip ${tool}: not in the live catalog`);
    continue;
  }
  const r = await client.call(tool, args);
  const env: any = r.envelope;
  const tag = tool + (args.symbol ? `-${String(args.symbol).toLowerCase()}` : "");
  save(`fixtures/ryo/samples/${tag}.json`, r);
  console.log(`${tool.padEnd(32)} http=${r.httpStatus} status=${env?.status ?? "-"} data_mode=${env?.data_mode ?? "-"} attempts=${r.attempts} ${r.error ?? ""}`);
}
console.log("\nSaved fixtures/ryo/tools.json and fixtures/ryo/samples/. Commit and push them.");
