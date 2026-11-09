import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Connection to the real RYO-CHAN MCP server. Configured only through environment variables so no key ever lands
 * in the repo:
 *   RYO_MCP_URL          https endpoint (streamable HTTP, falls back to SSE), or
 *   RYO_MCP_COMMAND      a local command for a stdio server, e.g. "npx -y @ryo/mcp"
 *   RYO_API_KEY          the credential (secret)
 *   RYO_API_KEY_HEADER   header that carries it (default: Authorization, sent as "Bearer <key>")
 *   RYO_KEY_ID           the key id, when the server wants it separately
 *   RYO_KEY_ID_HEADER    header that carries the key id (default: X-Key-Id)
 */
export type RyoConfig = { url?: string; command?: string; apiKey?: string; apiKeyHeader?: string; keyId?: string; keyIdHeader?: string };

export function ryoConfigFromEnv(env: Record<string, string | undefined> = process.env): RyoConfig {
  return {
    url: env.RYO_MCP_URL,
    command: env.RYO_MCP_COMMAND,
    apiKey: env.RYO_API_KEY,
    apiKeyHeader: env.RYO_API_KEY_HEADER,
    keyId: env.RYO_KEY_ID,
    keyIdHeader: env.RYO_KEY_ID_HEADER,
  };
}

function headers(config: RyoConfig): Record<string, string> {
  const out: Record<string, string> = {};
  if (config.apiKey) {
    const name = config.apiKeyHeader || "Authorization";
    out[name] = name.toLowerCase() === "authorization" ? `Bearer ${config.apiKey}` : config.apiKey;
  }
  if (config.keyId) out[config.keyIdHeader || "X-Key-Id"] = config.keyId;
  return out;
}

export async function connectRyo(config: RyoConfig = ryoConfigFromEnv()): Promise<{ client: Client; transport: string }> {
  const client = new Client({ name: "echo-ledger", version: "2.0.0" });
  if (config.command) {
    const [cmd, ...args] = config.command.split(/\s+/).filter(Boolean);
    await client.connect(new StdioClientTransport({ command: cmd!, args, env: { ...(process.env as Record<string, string>) } }));
    return { client, transport: "stdio" };
  }
  if (!config.url) throw new Error("Set RYO_MCP_URL (or RYO_MCP_COMMAND) to reach the RYO-CHAN MCP server.");
  const url = new URL(config.url);
  const requestInit = { headers: headers(config) };
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit }));
    return { client, transport: "streamable-http" };
  } catch (first) {
    const fallback = new Client({ name: "echo-ledger", version: "2.0.0" });
    try {
      await fallback.connect(new SSEClientTransport(url, { requestInit, eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers as Record<string, string>), ...headers(config) } }) } }));
      return { client: fallback, transport: "sse" };
    } catch {
      throw first;
    }
  }
}

/** Never print a secret: strip the key from any text before it is logged or saved. */
export function redact(text: string, config: RyoConfig = ryoConfigFromEnv()): string {
  let out = text;
  for (const secret of [config.apiKey, config.keyId]) if (secret && secret.length >= 6) out = out.split(secret).join("[REDACTED]");
  return out;
}
