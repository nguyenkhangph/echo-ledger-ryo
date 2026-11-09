// Runs the evaluation set and prints accuracy and the rate of invented numbers. Exit code 1 if any case is wrong.
import { writeFileSync } from "node:fs";
import { runEval } from "../shared/src/ryo";
const r = runEval();
for (const row of r.rows) console.log(`${row.correct ? "PASS" : "FAIL"}  ${row.id.padEnd(20)} expected ${row.expected.padEnd(22)} got ${row.got}`);
console.log(`\n${r.correct}/${r.total} correct (${(r.accuracy * 100).toFixed(0)}%) · invented numbers: ${r.invented} (${(r.inventedRate * 100).toFixed(0)}%)`);
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(r, null, 2) + "\n");
process.exit(r.correct === r.total && r.invented === 0 ? 0 : 1);
