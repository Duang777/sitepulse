import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runSchema, type InspectionRun } from "./contracts";

// The directory is intentionally configurable at runtime for local, disposable inspection records.
export const dataDir = path.resolve(/* turbopackIgnore: true */ process.env.SITEPULSE_DATA_DIR || "./data");

export function runDirectory(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("无效的巡检 ID");
  return path.join(/* turbopackIgnore: true */ dataDir, id);
}

export async function saveRun(run: InspectionRun): Promise<void> {
  const directory = runDirectory(run.id);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.run-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(run, null, 2), { mode: 0o600 });
  await rename(temporary, path.join(directory, "run.json"));
}

export async function readRun(id: string): Promise<InspectionRun | null> {
  try { return runSchema.parse(JSON.parse(await readFile(path.join(runDirectory(id), "run.json"), "utf8"))); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function listRuns(): Promise<InspectionRun[]> {
  await mkdir(dataDir, { recursive: true });
  const entries = await readdir(/* turbopackIgnore: true */ dataDir, { withFileTypes: true });
  const runs = await Promise.all(entries.filter((entry) => entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name)).map((entry) => readRun(entry.name)));
  return runs.filter((run): run is InspectionRun => run !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteRun(id: string): Promise<void> { await rm(runDirectory(id), { recursive: true, force: true }); }
