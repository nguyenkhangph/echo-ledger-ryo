import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { latestCandidatesFile, replayRun, runRyoStage, type RyoRun } from "./stage";
import { recheckToken, settleDue } from "./followup";

const root = resolve(import.meta.dir, "../../..");
const args = Bun.argv.slice(2);
const arg = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const outDir = join(root, "fixtures/ryo/runs");
const latestRun = () => arg("--run") ?? join(outDir, JSON.parse(readFileSync(join(outDir, "latest.json"), "utf8")).run);

if (args[0] === "replay") {
  const run = JSON.parse(readFileSync(latestRun(), "utf8")) as RyoRun;
  const rows = replayRun(run);
  for (const r of rows) console.log(`${r.same ? "SAME" : "DIFF"}  ${r.token.padEnd(6)} ${r.stored} ${r.same ? "" : `≠ ${r.replayed}`}`);
  console.log(`${rows.filter((r) => r.same).length}/${rows.length} decisions reproduced from stored evidence, no RYO call made.`);
  process.exit(rows.every((r) => r.same) ? 0 : 1);
} else if (args[0] === "recheck") {
  const token = arg("--token");
  if (!token) throw new Error("usage: bun run ryo:recheck --token SOL [--run fixtures/ryo/runs/<id>.json]");
  await recheckToken({ runFile: latestRun(), token });
} else if (args[0] === "settle") {
  await settleDue({ runsDir: outDir, outDir: join(root, "fixtures/ryo/settlements"), force: args.includes("--force") });
} else {
  const candidatesFile = arg("--candidates") ?? latestCandidatesFile(join(root, "fixtures/candidates"));
  await runRyoStage({ candidatesFile, outDir, maxTokens: Number(arg("--max") ?? 4) });
}
