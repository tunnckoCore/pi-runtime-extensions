import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  getManifestPath,
  getRuntimeEntryBaseName,
  getRuntimeRootDir,
  getSettingsPath,
  resolveProjectSettingPath,
} from "./path-utils.ts";
import type { Manifest, RuntimeEntry } from "./types.ts";

export function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

export function defaultManifest(): Manifest {
  return { version: 1, entries: [] };
}

export function asManifest(value: unknown): Manifest {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: number }).version === 1 &&
    Array.isArray((value as { entries?: unknown }).entries)
  ) {
    return value as Manifest;
  }

  return defaultManifest();
}

export function readManifest(cwd: string): Manifest {
  const manifestPath = getManifestPath(cwd);
  if (!existsSync(manifestPath)) {
    return defaultManifest();
  }

  try {
    return asManifest(JSON.parse(readFileSync(manifestPath, "utf-8")));
  } catch {
    return defaultManifest();
  }
}

export function writeManifest(cwd: string, manifest: Manifest): void {
  const manifestPath = getManifestPath(cwd);

  if (manifest.entries.length === 0) {
    rmSync(manifestPath, { force: true });
    return;
  }

  ensureDir(dirname(manifestPath));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}

export function ownsRuntimePath(cwd: string, runtimePath: string | undefined): boolean {
  if (!runtimePath) return false;
  return runtimePath.startsWith(getRuntimeRootDir(cwd));
}

export function deleteRuntimeFile(runtimePath: string | undefined): void {
  if (!runtimePath) return;
  rmSync(runtimePath, { recursive: true, force: true });
}

export function pruneManifest(cwd: string, manifest: Manifest): Manifest {
  const deduped = new Map<string, RuntimeEntry>();

  for (const raw of manifest.entries) {
    if (typeof raw?.sourcePath !== "string" || typeof raw?.enabled !== "boolean") {
      continue;
    }

    const entry: RuntimeEntry = {
      sourcePath: raw.sourcePath,
      enabled: raw.enabled,
      runtimePath: typeof raw.runtimePath === "string" ? raw.runtimePath : undefined,
      loadedAt: typeof raw.loadedAt === "string" ? raw.loadedAt : undefined,
    };

    if (entry.runtimePath && !ownsRuntimePath(cwd, entry.runtimePath)) {
      entry.runtimePath = undefined;
      entry.loadedAt = undefined;
      entry.enabled = false;
    }

    if (!entry.enabled) {
      if (entry.runtimePath) {
        deleteRuntimeFile(entry.runtimePath);
      }
      entry.runtimePath = undefined;
      entry.loadedAt = undefined;
    } else if (!entry.runtimePath || !existsSync(entry.runtimePath)) {
      entry.enabled = false;
      entry.runtimePath = undefined;
      entry.loadedAt = undefined;
    }

    deduped.set(entry.sourcePath, entry);
  }

  return { version: 1, entries: Array.from(deduped.values()) };
}

function readProjectSettings(cwd: string): Record<string, unknown> {
  const settingsPath = getSettingsPath(cwd);
  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeProjectSettings(cwd: string, settings: Record<string, unknown>): void {
  const settingsPath = getSettingsPath(cwd);
  const entries = Object.entries(settings).filter(([, value]) => value !== undefined);

  if (entries.length === 0) {
    rmSync(settingsPath, { force: true });
    return;
  }

  ensureDir(dirname(settingsPath));
  writeFileSync(settingsPath, JSON.stringify(Object.fromEntries(entries), null, 2), "utf-8");
}

function syncManagedExtensions(cwd: string, manifest: Manifest): void {
  const settings = readProjectSettings(cwd);
  const current = Array.isArray(settings.extensions)
    ? settings.extensions.filter((value): value is string => typeof value === "string")
    : [];

  const unmanaged = current.filter((entry) => !ownsRuntimePath(cwd, resolveProjectSettingPath(cwd, entry)));
  const managed = manifest.entries
    .filter((entry) => entry.enabled && typeof entry.runtimePath === "string")
    .map((entry) => entry.runtimePath!);

  const nextExtensions = [...unmanaged, ...managed];
  if (nextExtensions.length > 0) {
    settings.extensions = nextExtensions;
  } else {
    delete settings.extensions;
  }

  writeProjectSettings(cwd, settings);
}

export function listKnownEntries(cwd: string): RuntimeEntry[] {
  const manifest = pruneManifest(cwd, readManifest(cwd));
  writeManifest(cwd, manifest);
  syncManagedExtensions(cwd, manifest);
  return manifest.entries;
}

function createRuntimeEntryId(sourcePath: string): string {
  return createHash("sha1")
    .update(`${sourcePath}:${Date.now()}:${randomUUID()}`)
    .digest("hex")
    .slice(0, 8);
}

export function makeRuntimeCopy(cwd: string, sourcePath: string): string {
  const runtimeRootDir = getRuntimeRootDir(cwd);
  ensureDir(runtimeRootDir);

  const base = getRuntimeEntryBaseName(sourcePath);
  const entryDir = join(runtimeRootDir, `${base}-${createRuntimeEntryId(sourcePath)}`);

  ensureDir(entryDir);

  const sourceSpecifier = JSON.stringify(sourcePath);
  const wrapperSource = [
    `export { default } from ${sourceSpecifier};`,
    `export * from ${sourceSpecifier};`,
    "",
  ].join("\n");

  writeFileSync(join(entryDir, "index.ts"), wrapperSource, "utf-8");
  return entryDir;
}

export function setEntryEnabled(cwd: string, sourcePath: string, enabled: boolean): RuntimeEntry {
  const manifest = pruneManifest(cwd, readManifest(cwd));
  const existing = manifest.entries.find((entry) => entry.sourcePath === sourcePath);

  if (enabled) {
    if (existing?.runtimePath) {
      deleteRuntimeFile(existing.runtimePath);
    }

    const runtimePath = makeRuntimeCopy(cwd, sourcePath);
    const next: RuntimeEntry = {
      sourcePath,
      enabled: true,
      runtimePath,
      loadedAt: new Date().toISOString(),
    };

    const withoutCurrent = manifest.entries.filter((entry) => entry.sourcePath !== sourcePath);
    withoutCurrent.push(next);
    const nextManifest: Manifest = { version: 1, entries: withoutCurrent };
    writeManifest(cwd, nextManifest);
    syncManagedExtensions(cwd, nextManifest);
    return next;
  }

  if (existing?.runtimePath) {
    deleteRuntimeFile(existing.runtimePath);
  }

  const next: RuntimeEntry = {
    sourcePath,
    enabled: false,
  };

  const withoutCurrent = manifest.entries.filter((entry) => entry.sourcePath !== sourcePath);
  withoutCurrent.push(next);
  const nextManifest: Manifest = { version: 1, entries: withoutCurrent };
  writeManifest(cwd, nextManifest);
  syncManagedExtensions(cwd, nextManifest);
  return next;
}

export function removeTrackedEntry(cwd: string, sourcePath: string): RuntimeEntry | undefined {
  const manifest = pruneManifest(cwd, readManifest(cwd));
  const existing = manifest.entries.find((entry) => entry.sourcePath === sourcePath);
  if (!existing) {
    return undefined;
  }

  deleteRuntimeFile(existing.runtimePath);

  const nextManifest: Manifest = {
    version: 1,
    entries: manifest.entries.filter((entry) => entry.sourcePath !== sourcePath),
  };
  writeManifest(cwd, nextManifest);
  syncManagedExtensions(cwd, nextManifest);

  return existing;
}

export function clearSessionRuntimeEntries(cwd: string): void {
  const manifest = pruneManifest(cwd, readManifest(cwd));
  for (const entry of manifest.entries) {
    deleteRuntimeFile(entry.runtimePath);
  }
  const nextManifest: Manifest = { version: 1, entries: [] };
  writeManifest(cwd, nextManifest);
  syncManagedExtensions(cwd, nextManifest);
}
