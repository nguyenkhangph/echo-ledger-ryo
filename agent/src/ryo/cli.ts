import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { latestCandidatesFile, replayRun, runRyoStage, type RyoRun } from "./stage";

const root = resolve(import.meta.dir, "../../..");
const args = Bun.argv.slice(2);
const arg = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const outDir = join(root, "fixtures/ryo/runs");

if (args[0] === "replay") {
  const file = arg("--run") ?? join(outDir, JSON.parse(readFileSync(join(outDir, "latest.json"), "utf8")).run);
  const run = JSON.parse(readFileSync(file, "utf8")) as RyoRun;
  const rows = replayRun(run);
  for (const r of rows) console.log(`${r.same ? "SAME" : "DIFF"}  ${r.token.padEnd(6)} ${r.stored} ${r.same ? "" : `≠ ${r.replayed}`}`);
  console.log(`${rows.filter((r) => r.same).length}/${rows.length} decisions reproduced from stored evidence, no RYO call made.`);
  process.exit(rows.every((r) => r.same) ? 0 : 1);
}

const candidatesFile = arg("--candidates") ?? latestCandidatesFile(join(root, "fixtures/candidates"));
await runRyoStage({ candidatesFile, outDir, maxTokens: Number(arg("--max") ?? 4) });
