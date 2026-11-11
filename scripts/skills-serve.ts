import { makeHandler } from "../agent/src/skills/server";
import { RyoClient } from "../agent/src/ryo/client";

// bun run skills:serve → http://localhost:8790 (GET /tools, POST /tools/{name}/call, POST /mcp)
const port = Number(process.env.SKILLS_PORT ?? 8790);
const ryo = process.env.RYO_MCP_KEY ? new RyoClient() : null;
Bun.serve({ port, fetch: makeHandler(ryo) });
console.log(`Echo Ledger skills on http://localhost:${port} · narrative_independence, stale_call · RYO ${ryo ? "configured" : "not configured (stale_call degrades to age only)"}`);
