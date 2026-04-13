import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  asManifest,
  clearSessionRuntimeEntries,
  pruneManifest,
  readManifest,
  setEntryEnabled,
  writeManifest,
} from "../src/manifest-store.ts";
import { getManifestPath, getRuntimeRootDir } from "../src/path-utils.ts";
import type { Manifest } from "../src/types.ts";

function createStoreWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-ext-store-"));
  const sourcePath = join(cwd, "demo.ts");
  writeFileSync(sourcePath, "export default function () {}\n", "utf-8");

  return {
    cwd,
    sourcePath,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

test("asManifest falls back to an empty manifest for invalid input", () => {
  expect(asManifest(undefined)).toEqual({ version: 1, entries: [] });
  expect(asManifest({ version: 2, entries: [] })).toEqual({ version: 1, entries: [] });
  expect(asManifest({ version: 1, entries: "bad" })).toEqual({ version: 1, entries: [] });
});

test("readManifest falls back to default for invalid JSON", () => {
  const workspace = createStoreWorkspace();

  try {
    mkdirSync(dirname(getManifestPath(workspace.cwd)), { recursive: true });
    writeFileSync(getManifestPath(workspace.cwd), "{bad-json", "utf-8");

    expect(readManifest(workspace.cwd)).toEqual({ version: 1, entries: [] });
  } finally {
    workspace.cleanup();
  }
});

test("pruneManifest removes malformed entries and keeps valid ones", () => {
  const workspace = createStoreWorkspace();

  try {
    const manifest = pruneManifest(workspace.cwd, {
      version: 1,
      entries: [
        { sourcePath: workspace.sourcePath, enabled: false },
        { sourcePath: 42 as any, enabled: true },
        { sourcePath: join(workspace.cwd, "bad.ts"), enabled: "yes" as any },
      ],
    });

    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]?.sourcePath).toBe(workspace.sourcePath);
    expect(manifest.entries[0]?.enabled).toBe(false);
  } finally {
    workspace.cleanup();
  }
});

test("pruneManifest disables entries whose runtime path is not owned by the extension", () => {
  const workspace = createStoreWorkspace();

  try {
    const foreignRuntime = join(workspace.cwd, "foreign.ts");
    writeFileSync(foreignRuntime, "export default function () {}\n", "utf-8");

    const manifest: Manifest = {
      version: 1,
      entries: [
        {
          sourcePath: workspace.sourcePath,
          enabled: true,
          runtimePath: foreignRuntime,
          loadedAt: "now",
        },
      ],
    };

    const pruned = pruneManifest(workspace.cwd, manifest);
    expect(pruned.entries).toHaveLength(1);
    expect(pruned.entries[0]?.enabled).toBe(false);
    expect(pruned.entries[0]?.runtimePath).toBeUndefined();
    expect(pruned.entries[0]?.loadedAt).toBeUndefined();
    expect(existsSync(foreignRuntime)).toBe(true);
  } finally {
    workspace.cleanup();
  }
});

test("pruneManifest deletes runtime files for disabled tracked entries", () => {
  const workspace = createStoreWorkspace();

  try {
    mkdirSync(getRuntimeRootDir(workspace.cwd), { recursive: true });
    const runtimePath = join(getRuntimeRootDir(workspace.cwd), "runtime-extension-disabled");
    mkdirSync(runtimePath, { recursive: true });
    writeFileSync(join(runtimePath, "index.ts"), "export default function () {}\n", "utf-8");

    const pruned = pruneManifest(workspace.cwd, {
      version: 1,
      entries: [
        {
          sourcePath: workspace.sourcePath,
          enabled: false,
          runtimePath,
          loadedAt: "now",
        },
      ],
    });

    expect(existsSync(runtimePath)).toBe(false);
    expect(pruned.entries).toHaveLength(1);
    expect(pruned.entries[0]?.enabled).toBe(false);
    expect(pruned.entries[0]?.runtimePath).toBeUndefined();
  } finally {
    workspace.cleanup();
  }
});

test("pruneManifest turns enabled entries off when their runtime file is missing", () => {
  const workspace = createStoreWorkspace();

  try {
    const missingRuntime = join(getRuntimeRootDir(workspace.cwd), "runtime-extension-missing");
    const pruned = pruneManifest(workspace.cwd, {
      version: 1,
      entries: [
        {
          sourcePath: workspace.sourcePath,
          enabled: true,
          runtimePath: missingRuntime,
          loadedAt: "now",
        },
      ],
    });

    expect(pruned.entries).toHaveLength(1);
    expect(pruned.entries[0]?.enabled).toBe(false);
    expect(pruned.entries[0]?.runtimePath).toBeUndefined();
    expect(pruned.entries[0]?.loadedAt).toBeUndefined();
  } finally {
    workspace.cleanup();
  }
});

test("writeManifest removes the manifest file when entries are empty", () => {
  const workspace = createStoreWorkspace();

  try {
    const manifestPath = getManifestPath(workspace.cwd);
    writeManifest(workspace.cwd, {
      version: 1,
      entries: [
        {
          sourcePath: workspace.sourcePath,
          enabled: false,
        },
      ],
    });

    expect(existsSync(manifestPath)).toBe(true);

    writeManifest(workspace.cwd, { version: 1, entries: [] });

    expect(existsSync(manifestPath)).toBe(false);
    expect(readManifest(workspace.cwd)).toEqual({ version: 1, entries: [] });
  } finally {
    workspace.cleanup();
  }
});

test("clearSessionRuntimeEntries removes enabled runtime files and resets manifest", () => {
  const workspace = createStoreWorkspace();

  try {
    const enabled = setEntryEnabled(workspace.cwd, workspace.sourcePath, true);
    expect(existsSync(enabled.runtimePath!)).toBe(true);

    const manifestPath = getManifestPath(workspace.cwd);

    clearSessionRuntimeEntries(workspace.cwd);

    expect(existsSync(enabled.runtimePath!)).toBe(false);
    expect(existsSync(manifestPath)).toBe(false);
    expect(readManifest(workspace.cwd)).toEqual({ version: 1, entries: [] });
  } finally {
    workspace.cleanup();
  }
});

test("writeManifest persists data that readManifest can restore", () => {
  const workspace = createStoreWorkspace();

  try {
    const manifest: Manifest = {
      version: 1,
      entries: [
        {
          sourcePath: workspace.sourcePath,
          enabled: false,
        },
      ],
    };

    writeManifest(workspace.cwd, manifest);
    expect(readManifest(workspace.cwd)).toEqual(manifest);
  } finally {
    workspace.cleanup();
  }
});
