import {
  EvidenceBook,
  INDEPENDENCE_DEFINITION,
  INDEPENDENCE_TOOL,
  narrativeIndependence,
  STALE_DEFINITION,
  STALE_TOOL,
  staleCall,
  type IndependenceArgs,
  type StaleArgs,
} from "@echo/shared/ryo";
import { RyoClient } from "../ryo/client";

/**
 * Echo Ledger's Track 3 skills served the way RYO serves its tools: GET /tools, POST /tools/{name}/call returning
 * {"result": envelope}, and a minimal MCP JSON-RPC endpoint (POST /mcp: tools/list, tools/call) whose text content
 * holds the same envelope. Read-only; no key is needed to call these skills. stale_call uses the server's own
 * RYO_MCP_KEY to fetch analyze_token; without one it degrades to an age-only result marked partial.
 */
export const SKILLS = [INDEPENDENCE_DEFINITION, STALE_DEFINITION];

export async function callSkill(name: string, args: Record<string, unknown>, ryo: RyoClient | null) {
  if (name === INDEPENDENCE_TOOL) return narrativeIndependence(args as unknown as IndependenceArgs);
  if (name === STALE_TOOL) {
    const a = args as unknown as StaleArgs;
    let evidence;
    if (ryo && typeof a.symbol === "string" && a.symbol.trim()) {
      const r = await ryo.call("analyze_token", { symbol: a.symbol.trim().toUpperCase() });
      evidence = new EvidenceBook().add("analyze_token", { symbol: a.symbol }, r.envelope ?? (r.error ? { error: r.error } : null), r.calledAt, !r.ok);
    }
    return staleCall(a, evidence);
  }
  return null;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function makeHandler(ryo: RyoClient | null) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") return json({ ok: true, skills: SKILLS.map((s) => s.name), ryo: ryo ? "configured" : "not configured" });
    if (req.method === "GET" && url.pathname === "/tools") return json({ tools: SKILLS });
    const m = url.pathname.match(/^\/tools\/([a-z_]+)\/call$/);
    if (req.method === "POST" && m) {
      let args: Record<string, unknown>;
      try {
        args = (await req.json()) as Record<string, unknown>;
      } catch {
        return json({ error: { code: "INVALID_ARGUMENTS", message: "body must be a JSON object of arguments" } }, 400);
      }
      const result = await callSkill(m[1]!, args ?? {}, ryo);
      return result ? json({ result }) : json({ error: { code: "UNKNOWN_TOOL", message: `no skill named ${m[1]}` } }, 404);
    }
    if (req.method === "POST" && url.pathname === "/mcp") {
      const rpc = (await req.json().catch(() => null)) as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } } | null;
      if (!rpc) return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      if (rpc.method === "initialize") return json({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "echo-ledger-skills", version: "1.0.0" }, capabilities: { tools: {} } } });
      if (rpc.method === "tools/list") return json({ jsonrpc: "2.0", id: rpc.id, result: { tools: SKILLS } });
      if (rpc.method === "tools/call") {
        const result = await callSkill(rpc.params?.name ?? "", rpc.params?.arguments ?? {}, ryo);
        if (!result) return json({ jsonrpc: "2.0", id: rpc.id, result: { isError: true, content: [{ type: "text", text: `no skill named ${rpc.params?.name}` }] } });
        return json({ jsonrpc: "2.0", id: rpc.id, result: { isError: result.status === "unavailable", content: [{ type: "text", text: JSON.stringify(result) }] } });
      }
      return json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "method not found" } });
    }
    return json({ error: { code: "NOT_FOUND" } }, 404);
  };
}
