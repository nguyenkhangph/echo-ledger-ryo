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
 * Status of one RYO result, from the public envelope (RYO Builder MCP Guide): `status` is ok, partial or unavailable;
 * `data_mode` is live, mixed, simulated or unknown. Only status ok with data_mode live counts as live evidence.
 * Anything else is recorded as what it is and never used as a live number.
 */
export function classifyStatus(payload: unknown, isError = false): { status: RyoStatus; reason: string | null } {
  if (isError) return { status: "unavailable", reason: "the tool returned an error" };
  if (payload == null || typeof payload !== "object") return { status: "unavailable", reason: "no result envelope" };
  const o = payload as Record<string, unknown>;
  const st = lower(o.status);
  const mode = lower(o.data_mode);
  if (mode === "simulated") return { status: "simulated", reason: "data_mode is simulated" };
  if (st === "unavailable") return { status: "unavailable", reason: "status is unavailable" };
  if (st === "partial") return { status: "partial", reason: "status is partial: a primary section is incomplete" };
  if (mode === "mixed") return { status: "partial", reason: "data_mode is mixed: not every section is live" };
  if (mode === "unknown" || (mode === "" && "data_mode" in o)) return { status: "partial", reason: "data_mode is unknown" };
  if (st === "ok" && mode === "live") return { status: "live", reason: null };
  // Envelopes outside the published contract (tests, older servers): fall back to self-declared flags.
  const meta = (o.meta ?? {}) as Record<string, unknown>;
  const flags = [o.status, o.mode, meta.status, meta.mode].map(lower);
  if (o.simulated === true || flags.some((f) => /simulat|mock|demo|synthetic/.test(f))) return { status: "simulated", reason: "the payload says its data is simulated" };
  if (o.error != null || flags.some((f) => /unavailable|error|fail/.test(f))) return { status: "unavailable", reason: typeof o.error === "string" ? o.error : "the payload says the data is unavailable" };
  if (o.partial === true || flags.some((f) => /partial|stale|degraded/.test(f))) return { status: "partial", reason: "the payload says its data is partial" };
  return { status: "live", reason: null };
}

export class EvidenceBook {
  private items: RyoEvidence[] = [];

  /** `offset` continues numbering after an earlier book (rechecks and settlements extend a run: E31, E32, …). */
  constructor(private offset = 0) {}

  add(tool: string, args: Record<string, unknown>, payload: unknown, fetchedAt: string, isError = false): RyoEvidence {
    const { status, reason } = classifyStatus(payload, isError);
    const item: RyoEvidence = {
      id: `E${this.offset + this.items.length + 1}` as EvidenceId,
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
