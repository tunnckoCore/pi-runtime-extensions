import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  enableExtensionFromPath,
  removeEntry,
  showToggleList,
  showUnloadList,
  toggleEntry,
} from "../src/command-actions.ts";
import { LOAD_MENU_LABEL } from "../src/constants.ts";
import { listKnownEntries, setEntryEnabled } from "../src/manifest-store.ts";
import { formatEntryLabel } from "../src/path-utils.ts";
import { createWorkspace } from "./helpers.ts";

function createUnitContext(cwd: string, options?: {
  input?: () => Promise<string | undefined>;
  select?: (title: string, choices: string[]) => Promise<string | undefined>;
  reload?: () => Promise<void>;
}) {
  const notifications: Array<{ message: string; type?: string }> = [];
  let waitCalls = 0;
  let reloadCalls = 0;

  const ctx = {
    cwd,
    async waitForIdle() {
      waitCalls += 1;
    },
    async reload() {
      reloadCalls += 1;
      await options?.reload?.();
    },
    ui: {
      notify(message: string, type?: string) {
        notifications.push({ message, type });
      },
      async input() {
        return (await options?.input?.()) ?? undefined;
      },
      async select(title: string, choices: string[]) {
        return (await options?.select?.(title, choices)) ?? undefined;
      },
    },
  };

  return {
    ctx,
    notifications,
    get waitCalls() {
      return waitCalls;
    },
    get reloadCalls() {
      return reloadCalls;
    },
  };
}

test("enableExtensionFromPath returns quietly when prompt is cancelled", async () => {
  const workspace = createWorkspace();

  try {
    const unit = createUnitContext(workspace.cwd, {
      input: async () => undefined,
    });

    await enableExtensionFromPath(undefined, unit.ctx as any, () => {});

    expect(unit.notifications).toHaveLength(0);
    expect(unit.waitCalls).toBe(0);
    expect(unit.reloadCalls).toBe(0);
    expect(listKnownEntries(workspace.cwd)).toHaveLength(0);
  } finally {
    workspace.cleanup();
  }
});

test("enableExtensionFromPath reports usage errors for empty quoted paths", async () => {
  const workspace = createWorkspace();

  try {
    const unit = createUnitContext(workspace.cwd);

    await enableExtensionFromPath('""', unit.ctx as any, () => {});

    expect(unit.notifications[0]?.message).toBe("Usage: /ext:load <path>");
    expect(unit.notifications[0]?.type).toBe("error");
    expect(unit.waitCalls).toBe(0);
  } finally {
    workspace.cleanup();
  }
});

test("enableExtensionFromPath reports file-not-found errors", async () => {
  const workspace = createWorkspace();

  try {
    const unit = createUnitContext(workspace.cwd);

    await enableExtensionFromPath("./missing-ext.ts", unit.ctx as any, () => {});

    expect(unit.notifications[0]?.message).toContain("File not found");
    expect(unit.notifications[0]?.type).toBe("error");
    expect(unit.waitCalls).toBe(0);
    expect(unit.reloadCalls).toBe(0);
  } finally {
    workspace.cleanup();
  }
});

test("enableExtensionFromPath rejects directory paths", async () => {
  const workspace = createWorkspace();

  try {
    const dirPath = join(workspace.cwd, "dir-ext");
    mkdirSync(dirPath, { recursive: true });
    const unit = createUnitContext(workspace.cwd);

    await enableExtensionFromPath(dirPath, unit.ctx as any, () => {});

    expect(unit.notifications[0]?.message).toBe("Extension path must be a file");
    expect(unit.notifications[0]?.type).toBe("error");
    expect(listKnownEntries(workspace.cwd)).toHaveLength(0);
  } finally {
    workspace.cleanup();
  }
});

test("enableExtensionFromPath rejects unsupported suffixes", async () => {
  const workspace = createWorkspace();

  try {
    const badFile = join(workspace.cwd, "not-an-extension.txt");
    writeFileSync(badFile, "hello", "utf-8");
    const unit = createUnitContext(workspace.cwd);

    await enableExtensionFromPath(badFile, unit.ctx as any, () => {});

    expect(unit.notifications[0]?.message).toContain("Unsupported extension file type");
    expect(unit.notifications[0]?.type).toBe("error");
    expect(unit.waitCalls).toBe(0);
  } finally {
    workspace.cleanup();
  }
});

test("enableExtensionFromPath reports staging failures when runtime copy cannot be created", async () => {
  const workspace = createWorkspace();

  try {
    const brokenCwd = join(workspace.cwd, "not-a-directory.txt");
    writeFileSync(brokenCwd, "oops", "utf-8");
    const unit = createUnitContext(brokenCwd);

    await enableExtensionFromPath(workspace.sourceA, unit.ctx as any, () => {});

    expect(unit.notifications[0]?.message).toContain("Failed to stage extension:");
    expect(unit.notifications[0]?.type).toBe("error");
    expect(unit.reloadCalls).toBe(0);
  } finally {
    workspace.cleanup();
  }
});

test("enableExtensionFromPath rolls back to tracked-off when reload fails", async () => {
  const workspace = createWorkspace();
  const reloadingFlags: boolean[] = [];

  try {
    const unit = createUnitContext(workspace.cwd, {
      reload: async () => {
        throw new Error("boom");
      },
    });

    await enableExtensionFromPath(workspace.sourceA, unit.ctx as any, (value) => {
      reloadingFlags.push(value);
    });

    const entries = listKnownEntries(workspace.cwd);
    expect(unit.waitCalls).toBe(1);
    expect(unit.reloadCalls).toBe(1);
    expect(reloadingFlags).toEqual([true, false]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sourcePath).toBe(workspace.sourceA);
    expect(entries[0]?.enabled).toBe(false);
    expect(entries[0]?.runtimePath).toBeUndefined();
    expect(unit.notifications.some((item) => item.message.includes("Reload failed: boom"))).toBe(true);
  } finally {
    workspace.cleanup();
  }
});

test("showToggleList can load via the menu action and input prompt", async () => {
  const workspace = createWorkspace();

  try {
    const unit = createUnitContext(workspace.cwd, {
      select: async (_title, choices) => {
        expect(choices[0]).toBe(LOAD_MENU_LABEL);
        return LOAD_MENU_LABEL;
      },
      input: async () => workspace.sourceA,
    });

    await showToggleList(unit.ctx as any, () => {});

    const entries = listKnownEntries(workspace.cwd);
    expect(unit.reloadCalls).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.enabled).toBe(true);
    expect(existsSync(entries[0]?.runtimePath!)).toBe(true);
  } finally {
    workspace.cleanup();
  }
});

test("showToggleList returns quietly when selection is cancelled", async () => {
  const workspace = createWorkspace();

  try {
    const unit = createUnitContext(workspace.cwd, {
      select: async () => undefined,
    });

    await showToggleList(unit.ctx as any, () => {});

    expect(unit.reloadCalls).toBe(0);
    expect(unit.notifications).toHaveLength(0);
  } finally {
    workspace.cleanup();
  }
});

test("showToggleList ignores unknown selections", async () => {
  const workspace = createWorkspace();

  try {
    const unit = createUnitContext(workspace.cwd, {
      select: async () => "not a real option",
    });

    await showToggleList(unit.ctx as any, () => {});

    expect(unit.reloadCalls).toBe(0);
    expect(listKnownEntries(workspace.cwd)).toHaveLength(0);
  } finally {
    workspace.cleanup();
  }
});

test("removeEntry removes a tracked off entry completely", async () => {
  const workspace = createWorkspace();
  const reloadingFlags: boolean[] = [];

  try {
    setEntryEnabled(workspace.cwd, workspace.sourceA, false);
    const entry = listKnownEntries(workspace.cwd)[0]!;
    const unit = createUnitContext(workspace.cwd);

    await removeEntry(entry, unit.ctx as any, (value) => {
      reloadingFlags.push(value);
    });

    expect(unit.waitCalls).toBe(1);
    expect(unit.reloadCalls).toBe(1);
    expect(reloadingFlags).toEqual([true]);
    expect(listKnownEntries(workspace.cwd)).toHaveLength(0);
  } finally {
    workspace.cleanup();
  }
});

test("showUnloadList reports when nothing is tracked", async () => {
  const workspace = createWorkspace();

  try {
    const unit = createUnitContext(workspace.cwd);

    await showUnloadList(unit.ctx as any, () => {});

    expect(unit.notifications[0]?.message).toBe("No tracked dynamic extensions");
    expect(unit.notifications[0]?.type).toBe("info");
    expect(unit.reloadCalls).toBe(0);
  } finally {
    workspace.cleanup();
  }
});

test("showUnloadList ignores cancelled selection", async () => {
  const workspace = createWorkspace();

  try {
    setEntryEnabled(workspace.cwd, workspace.sourceA, true);
    const before = listKnownEntries(workspace.cwd);
    const unit = createUnitContext(workspace.cwd, {
      select: async (_title, choices) => {
        expect(choices).toHaveLength(1);
        expect(choices[0]).toBe(formatEntryLabel(workspace.cwd, before[0]!, 0));
        return undefined;
      },
    });

    await showUnloadList(unit.ctx as any, () => {});

    const after = listKnownEntries(workspace.cwd);
    expect(unit.reloadCalls).toBe(0);
    expect(after[0]?.enabled).toBe(true);
    expect(existsSync(after[0]?.runtimePath!)).toBe(true);
  } finally {
    workspace.cleanup();
  }
});

test("toggleEntry reports failures when enabling/disabling cannot stage files", async () => {
  const workspace = createWorkspace();

  try {
    const brokenCwd = join(workspace.cwd, "still-not-a-directory.txt");
    writeFileSync(brokenCwd, "oops", "utf-8");
    const unit = createUnitContext(brokenCwd);

    await toggleEntry({
      sourcePath: workspace.sourceA,
      enabled: false,
    }, unit.ctx as any, () => {});

    expect(unit.notifications[0]?.message).toContain("Failed to enable extension:");
    expect(unit.notifications[0]?.type).toBe("error");
    expect(unit.reloadCalls).toBe(0);
  } finally {
    workspace.cleanup();
  }
});

test("removeEntry restores the tracked entry when reload fails", async () => {
  const workspace = createWorkspace();
  const reloadingFlags: boolean[] = [];

  try {
    setEntryEnabled(workspace.cwd, workspace.sourceA, false);
    const entry = listKnownEntries(workspace.cwd)[0]!;
    const unit = createUnitContext(workspace.cwd, {
      reload: async () => {
        throw new Error("remove failed");
      },
    });

    await removeEntry(entry, unit.ctx as any, (value) => {
      reloadingFlags.push(value);
    });

    const entries = listKnownEntries(workspace.cwd);
    expect(reloadingFlags).toEqual([true, false]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sourcePath).toBe(workspace.sourceA);
    expect(entries[0]?.enabled).toBe(false);
    expect(unit.notifications.some((item) => item.message.includes("Reload failed: remove failed"))).toBe(true);
  } finally {
    workspace.cleanup();
  }
});

test("toggleEntry restores prior enabled state when reload fails during disable", async () => {
  const workspace = createWorkspace();
  const reloadingFlags: boolean[] = [];

  try {
    const enabled = setEntryEnabled(workspace.cwd, workspace.sourceA, true);
    const unit = createUnitContext(workspace.cwd, {
      reload: async () => {
        throw new Error("cannot reload");
      },
    });

    await toggleEntry(enabled, unit.ctx as any, (value) => {
      reloadingFlags.push(value);
    });

    const entries = listKnownEntries(workspace.cwd);
    expect(reloadingFlags).toEqual([true, false]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.enabled).toBe(true);
    expect(existsSync(entries[0]?.runtimePath!)).toBe(true);
    expect(unit.notifications.some((item) => item.message.includes("Reload failed: cannot reload"))).toBe(true);
  } finally {
    workspace.cleanup();
  }
});
