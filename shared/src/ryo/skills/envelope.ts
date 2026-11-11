/**
 * The public result envelope from the RYO Builder MCP Guide ("Public response contract"). Echo Ledger's own skills
 * return exactly this shape, so any client that already reads RYO tools can read ours without changes.
 *
 *   status:    ok (all primary evidence present) · partial (a primary section incomplete) · unavailable
 *   data_mode: live · mixed · simulated · unknown
 *   data:      structured evidence for program logic; summary is for display only
 *   Missing measurements are null, never zero.
 */
export const SKILL_SCHEMA_VERSION = "1.0";

export type SkillStatus = "ok" | "partial" | "unavailable";
export type SkillDataMode = "live" | "mixed" | "simulated" | "unknown";
export type Availability = "available" | "partial" | "unavailable";

export type SkillEnvelope<D> = {
  schema_version: string;
  tool: string;
  status: SkillStatus;
  data_mode: SkillDataMode;
  as_of: string;
  request: Record<string, unknown>;
  data: D | null;
  summary: { headline: string; key_points: string[] };
  availability: Record<string, Availability>;
  warnings: string[];
};

export function envelope<D>(e: Omit<SkillEnvelope<D>, "schema_version">): SkillEnvelope<D> {
  return { schema_version: SKILL_SCHEMA_VERSION, ...e };
}

/** Overall status from section availability: every primary section available → ok; none → unavailable. */
export function statusFrom(primary: Availability[]): SkillStatus {
  if (primary.length && primary.every((a) => a === "available")) return "ok";
  if (primary.every((a) => a === "unavailable")) return "unavailable";
  return "partial";
}

/** Tool definition in the shape RYO's GET /tools and MCP tools/list return. */
export type SkillDefinition = { name: string; description: string; inputSchema: Record<string, unknown> };
