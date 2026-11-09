import type { Hex } from "viem";
import { canonicalJson, cardHash } from "../hash";

/**
 * Every RYO-CHAN MCP response the agent uses becomes one numbered piece of evidence (E1, E2, …). Claims, gates and
 * trade levels cite these ids; the reasoning card carries the ids and payload hashes, so a reader can match any number
 * in a decision to the exact payload it came from.
 */
export type RyoStatus = "live" | "partial" | "unavailable" | "simulated";
export type EvidenceId = `E${number}`;

export type RyoEvidence = {
  id: EvidenceId;
  tool: string;
  args: Record<string, unknown>;
  status: RyoStatus;
  /** Why the status is not "live", in plain words. */
  statusReason: string | null;
  fetchedAt: string;
  payload: unknown;
  /** keccak256 of the canonical JSON payload. */
  payloadHash: Hex;
};

const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : "");

/**
 * Reads the status a payload declares about itself. Anything that says partial, unavailable, simulated, mock, demo,
 * stale or error is never treated as live data.
 */
export function classifyStatus(payload: unknown, isError = false): { status: RyoStatus; reason: string | null } {
  if (isError) return { status: "unavailable", reason: "the tool returned an error" };
  if (payload == null || (typeof payload === "string" && payload.trim() === "")) return { status: "unavailable", reason: "empty response" };
  if (typeof payload !== "object") return { status: "live", reason: null };
  const o = payload as Record<string, unknown>;
  const meta = (o.meta ?? o.metadata ?? {}) as Record<string, unknown>;
  const flags = [o.status, o.data_status, o.dataStatus, o.mode, o.source_mode, meta.status, meta.mode, meta.data_status].map(lower);
  if (o.simulated === true || meta.simulated === true || flags.some((f) => /simulat|mock|demo|synthetic|fake/.test(f)))
    return { status: "simulated", reason: "the payload says its data is simulated" };
  if (o.unavailable === true || o.error != null || flags.some((f) => /unavailable|error|fail|down|offline/.test(f)))
    return { status: "unavailable", reason: typeof o.error === "string" ? o.error : "the payload says the data is unavailable" };
  if (o.partial === true || meta.partial === true || flags.some((f) => /partial|stale|degraded|incomplete/.test(f)))
    return { status: "partial", reason: "the payload says its data is partial or stale" };
  return { status: "live", reason: null };
}

export class EvidenceBook {
  private items: RyoEvidence[] = [];

  add(tool: string, args: Record<string, unknown>, payload: unknown, fetchedAt: string, isError = false): RyoEvidence {
    const { status, reason } = classifyStatus(payload, isError);
    const item: RyoEvidence = {
      id: `E${this.items.length + 1}` as EvidenceId,
      tool,
      args,
      status,
      statusReason: reason,
      fetchedAt,
      payload: payload ?? null,
      payloadHash: cardHash(payload ?? null),
    };
    this.items.push(item);
    return item;
  }

  get(id: string): RyoEvidence | undefined {
    return this.items.find((e) => e.id === id);
  }

  all(): RyoEvidence[] {
    return [...this.items];
  }

  static from(items: RyoEvidence[]): EvidenceBook {
    const book = new EvidenceBook();
    book.items = [...items];
    return book;
  }
}

/** Reads a value by a simple path such as `data.price`, `tokens[0].symbol` or `result.content[0].text`. */
export function readPath(payload: unknown, path: string): unknown {
  if (path === "" || path === "$") return payload;
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = payload;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Summary of the evidence for the on-chain card: ids, tools, statuses and payload hashes, never the payloads. */
export const evidenceIndex = (items: RyoEvidence[]) =>
  items.map(({ id, tool, status, fetchedAt, payloadHash }) => ({ id, tool, status, fetched_at: fetchedAt, payload_hash: payloadHash }));

export const evidenceDigest = (items: RyoEvidence[]): Hex => cardHash(canonicalJson(evidenceIndex(items)));
