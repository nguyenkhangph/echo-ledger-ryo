// Lists the tools the live RYO-CHAN MCP server actually exposes and saves them, so the agent is wired to what exists
// rather than to what a homepage says. Usage (key stays in your shell, never in the repo):
//   $env:RYO_MCP_URL="https://..."; $env:RYO_API_KEY="..."; bun run ryo:tools
import { writeFileSync, mkdirSync } from "node:fs";
import { connectRyo, redact, ryoConfigFromEnv } from "../agent/src/ryo/client";

const out = process.argv[2] ?? "fixtures/ryo/tools.json";
const config = ryoConfigFromEnv();
const { client, transport } = await connectRyo(config);
const server = client.getServerVersion();
const tools = (await client.listTools()).tools;
mkdirSync(out.replace(/\/[^/]+$/, ""), { recursive: true });
const record = {
  listedAt: new Date().toISOString(),
  transport,
  server,
  endpoint: config.url ? new URL(config.url).origin : config.command,
  tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
};
writeFileSync(out, redact(JSON.stringify(record, null, 2)) + "\n");
console.log(`${tools.length} tools via ${transport} (${server?.name ?? "unknown server"} ${server?.version ?? ""}) → ${out}`);
for (const t of tools) console.log(`  ${t.name.padEnd(36)} ${(t.description ?? "").split("\n")[0]!.slice(0, 90)}`);
await client.close();
