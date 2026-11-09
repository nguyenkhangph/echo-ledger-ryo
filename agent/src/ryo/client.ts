/**
 * Client for RYO-CHAN's read-only research layer (https://app-ryochan.com/api/mcp), following the RYO Builder MCP
 * Guide: REST `POST {base}/tools/{tool}/call` with the bare argument object, MCP JSON-RPC `tools/call` as a fallback,
 * `Authorization: Bearer <key>`. The key is read from the environment only and is redacted from anything saved.
 *
 * Coping with failure, as the guide recommends:
 *  - exponential backoff with jitter on 429, 503 and network errors, honouring Retry-After;
 *  - no retry on invalid arguments or unknown tools;
 *  - a client-side throttle under the key's per-minute limit;
 *  - a tool error (HTTP 200 with isError) is returned as an unavailable result, never thrown away or turned into zero.
 */
export type RyoConfig = { url: string; key: string; perMinute: number; timeoutMs: number; maxAttempts: number };

export const DEFAULT_RYO_URL = "https://app-ryochan.com/api/mcp";

export function ryoConfigFromEnv(env: Record<string, string | undefined> = process.env): RyoConfig {
  return {
    url: (env.RYO_MCP_URL || DEFAULT_RYO_URL).replace(/\/$/, ""),
    key: env.RYO_MCP_KEY || "",
    perMinute: Number(env.RYO_RATE_PER_MINUTE || 50),
    timeoutMs: Number(env.RYO_TIMEOUT_MS || 60_000),
    maxAttempts: Number(env.RYO_MAX_ATTEMPTS || 4),
  };
}

export type RateLimit = { limit: number | null; remaining: number | null; reset: string | null };

export type RyoCall = {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** The public result envelope (schema_version, tool, status, data_mode, as_of, request, data, summary, availability, warnings). */
  envelope: Record<string, unknown> | null;
  isError: boolean;
  error: string | null;
  httpStatus: number | null;
  traceId: string | null;
  attempts: number;
  via: "rest" | "jsonrpc";
  rateLimit: RateLimit;
  calledAt: string;
  durationMs: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function redact(text: string, config: Pick<RyoConfig, "key"> = ryoConfigFromEnv()): string {
  return config.key && config.key.length >= 8 ? text.split(config.key).join("[REDACTED]") : text;
}

class Throttle {
  private stamps: number[] = [];
  constructor(private perMinute: number) {}
  async wait() {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 60_000);
      if (this.stamps.length < this.perMinute) {
        this.stamps.push(now);
        return;
      }
      await sleep(60_000 - (now - this.stamps[0]!) + 50);
    }
  }
}

export class RyoClient {
  private throttle: Throttle;
  private rpcId = 1;
  constructor(readonly config: RyoConfig = ryoConfigFromEnv(), private fetchImpl: typeof fetch = fetch) {
    this.throttle = new Throttle(Math.max(1, config.perMinute));
  }

  private headers(json = true): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.config.key) h.Authorization = `Bearer ${this.config.key}`;
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  private async get(path: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.config.url}${path}`, { headers: this.headers(false), signal: AbortSignal.timeout(this.config.timeoutMs) });
    const text = await response.text();
    if (!response.ok) throw new Error(`RYO ${path} HTTP ${response.status}: ${redact(text, this.config).slice(0, 300)}`);
    return JSON.parse(text);
  }

  health = () => this.get("/health");
  whoami = () => this.get("/whoami");
  tools = () => this.get("/tools");

  async call(tool: string, args: Record<string, unknown> = {}): Promise<RyoCall> {
    const started = Date.now();
    const calledAt = new Date(started).toISOString();
    let attempts = 0;
    let via: RyoCall["via"] = "rest";
    let last: Omit<RyoCall, "tool" | "args" | "attempts" | "via" | "calledAt" | "durationMs"> = {
      ok: false, envelope: null, isError: false, error: "not called", httpStatus: null, traceId: null, rateLimit: { limit: null, remaining: null, reset: null },
    };
    while (attempts < this.config.maxAttempts) {
      attempts += 1;
      await this.throttle.wait();
      let retryAfterMs: number | null = null;
      try {
        const response =
          via === "rest"
            ? await this.fetchImpl(`${this.config.url}/tools/${encodeURIComponent(tool)}/call`, { method: "POST", headers: this.headers(), body: JSON.stringify(args), signal: AbortSignal.timeout(this.config.timeoutMs) })
            : await this.fetchImpl(this.config.url, {
                method: "POST",
                headers: this.headers(),
                body: JSON.stringify({ jsonrpc: "2.0", id: this.rpcId++, method: "tools/call", params: { name: tool, arguments: args } }),
                signal: AbortSignal.timeout(this.config.timeoutMs),
              });
        const rateLimit: RateLimit = {
          limit: num(response.headers.get("X-RateLimit-Limit")),
          remaining: num(response.headers.get("X-RateLimit-Remaining")),
          reset: response.headers.get("X-RateLimit-Reset"),
        };
        const text = await response.text();
        let body: any = null;
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
        const traceId = body?.trace_id ?? body?.error?.trace_id ?? body?.traceId ?? response.headers.get("X-Trace-Id") ?? null;
        if (response.status === 404 && via === "rest" && attempts === 1) {
          via = "jsonrpc"; // older deployments: fall back to MCP JSON-RPC once, without counting it as a failure
          attempts -= 1;
          continue;
        }
        if (response.status === 429 || response.status === 503 || response.status >= 500) {
          const ra = response.headers.get("Retry-After");
          retryAfterMs = ra ? (Number.isFinite(Number(ra)) ? Number(ra) * 1000 : Math.max(0, Date.parse(ra) - Date.now())) : null;
          last = { ok: false, envelope: null, isError: false, error: `HTTP ${response.status}`, httpStatus: response.status, traceId, rateLimit };
        } else if (!response.ok) {
          // 400/401/403/404: retrying the same request cannot help.
          const message = body?.error?.message ?? body?.message ?? text.slice(0, 200);
          return { tool, args, ok: false, envelope: null, isError: false, error: redact(`HTTP ${response.status} ${body?.error?.code ?? body?.code ?? ""} ${message}`.trim(), this.config), httpStatus: response.status, traceId, attempts, via, rateLimit, calledAt, durationMs: Date.now() - started };
        } else if (via === "jsonrpc" && body?.error) {
          return { tool, args, ok: false, envelope: null, isError: false, error: redact(`MCP error ${body.error.code}: ${body.error.message}`, this.config), httpStatus: response.status, traceId, attempts, via, rateLimit, calledAt, durationMs: Date.now() - started };
        } else {
          const { envelope, isError, error } = unwrap(body, via);
          return { tool, args, ok: !isError && envelope != null, envelope, isError, error: error ? redact(error, this.config) : null, httpStatus: response.status, traceId, attempts, via, rateLimit, calledAt, durationMs: Date.now() - started };
        }
      } catch (e) {
        last = { ...last, ok: false, error: redact(e instanceof Error ? e.message : String(e), this.config), httpStatus: null };
      }
      if (attempts >= this.config.maxAttempts) break;
      const backoff = Math.min(30_000, 1000 * 2 ** (attempts - 1)) * (0.75 + Math.random() * 0.5);
      await sleep(retryAfterMs ?? backoff);
    }
    return { tool, args, ...last, attempts, via, calledAt, durationMs: Date.now() - started };
  }
}

const num = (v: string | null) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

/** REST returns `{ result: envelope }`; MCP returns `{ result: { content: [{type:"text", text: "<envelope json>"}], isError } }`. */
export function unwrap(body: any, via: "rest" | "jsonrpc"): { envelope: Record<string, unknown> | null; isError: boolean; error: string | null } {
  const result = body?.result ?? body;
  if (via === "jsonrpc" || Array.isArray(result?.content)) {
    const text = result?.content?.find?.((c: any) => c?.type === "text")?.text;
    if (result?.isError) return { envelope: null, isError: true, error: text ?? "RYO tool failed" };
    if (!text) return { envelope: null, isError: true, error: "RYO returned no text content" };
    try {
      return { envelope: JSON.parse(text), isError: false, error: null };
    } catch {
      return { envelope: null, isError: true, error: "RYO text content is not JSON" };
    }
  }
  if (result?.isError) return { envelope: null, isError: true, error: result?.error ?? "RYO tool failed" };
  return { envelope: result && typeof result === "object" ? result : null, isError: false, error: null };
}
