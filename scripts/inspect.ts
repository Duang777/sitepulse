import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { runInputSchema } from "../src/lib/contracts";
import { createRun, getRun } from "../src/lib/runner";
import { reportHtml } from "../src/lib/report";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";

try { process.loadEnvFile?.(".env.local"); }
catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
const { values } = parseArgs({ options: { file: { type: "string" }, out: { type: "string", default: "artifacts/cli-report.html" } } });
if (!values.file) {
  process.stderr.write("用法：bun run inspect --file examples/task.json [--out artifacts/report.html]\n");
  process.exitCode = 1;
} else {
  const config = runInputSchema.parse(JSON.parse(await readFile(values.file, "utf8")));
  let run = await createRun(config, "http://127.0.0.1:3000");
  while (run.status === "queued" || run.status === "running") {
    await delay(500);
    const current = await getRun(run.id);
    if (!current) throw new Error("巡检记录丢失");
    run = current;
  }
  await mkdir(path.dirname(values.out), { recursive: true });
  await writeFile(values.out, await reportHtml(run));
  process.stdout.write(`${run.status} · ${run.results.length} 个站点 · ${path.resolve(values.out)}\n`);
  if (run.status !== "completed") process.exitCode = 1;
}
