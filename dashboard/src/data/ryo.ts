import type { RyoRun, RyoSettlement } from "@echo/shared/ryo";

/** Saved RYO runs (fixtures/ryo/runs/*.json), newest first. These are real responses recorded by `bun run ryo:run`. */
const files = import.meta.glob("../../../fixtures/ryo/runs/*.json", { eager: true, import: "default" }) as Record<string, unknown>;

export const ryoRuns: RyoRun[] = Object.entries(files)
  .filter(([path]) => !path.endsWith("/latest.json"))
  .map(([, run]) => run as RyoRun)
  .filter((run) => run && run.kind === "echo-ledger/ryo-run@1")
  .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

export const latestRyoRun: RyoRun | null = ryoRuns[0] ?? null;

/** Settlements written by `bun run ryo:settle` (fixtures/ryo/settlements/*.json), newest first. */
const settlementFiles = import.meta.glob("../../../fixtures/ryo/settlements/*.json", { eager: true, import: "default" }) as Record<string, unknown>;
export const ryoSettlements: RyoSettlement[] = Object.values(settlementFiles)
  .map((s) => s as RyoSettlement)
  .filter((s) => s && s.kind === "echo-ledger/ryo-settlement@1")
  .sort((a, b) => b.settledAt.localeCompare(a.settledAt));
