import { existsSync, rmSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { ACCEPTED_EXTENSION_SUFFIXES, LOAD_MENU_LABEL } from "./constants.ts";
import { listKnownEntries, removeTrackedEntry, setEntryEnabled } from "./manifest-store.ts";
import { expandTilde, formatEntryLabel, parsePath } from "./path-utils.ts";
import type { RuntimeEntry } from "./types.ts";

export type SetReloading = (value: boolean) => void;

async function promptForPath(ctx: ExtensionCommandContext): Promise<string | undefined> {
  return await ctx.ui.input("Load extension", "path/to/extension.ts");
}

function notifyReloadError(error: unknown, ctx: ExtensionCommandContext): void {
  ctx.ui.notify(
    `Reload failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    "error",
  );
}

export async function enableExtensionFromPath(
  rawPath: string | undefined,
  ctx: ExtensionCommandContext,
  setReloading: SetReloading,
): Promise<void> {
  const provided = rawPath?.trim() ?? "";
  const prompted = provided || (await promptForPath(ctx));
  if (!prompted) {
    return;
  }

  const inputPath = parsePath(prompted);
  if (!inputPath) {
    ctx.ui.notify("Usage: /ext:load <path>", "error");
    return;
  }

  const sourcePath = resolve(ctx.cwd, expandTilde(inputPath));
  if (!existsSync(sourcePath)) {
    ctx.ui.notify(`File not found: ${inputPath}`, "error");
    return;
  }

  try {
    const stats = statSync(sourcePath);
    if (!stats.isFile()) {
      ctx.ui.notify("Extension path must be a file", "error");
      return;
    }
  } catch {
    ctx.ui.notify("Could not read source path", "error");
    return;
  }

  const extensionSuffix = extname(sourcePath).toLowerCase();
  if (!ACCEPTED_EXTENSION_SUFFIXES.has(extensionSuffix)) {
    ctx.ui.notify(`Unsupported extension file type: ${extensionSuffix || "(none)"}`, "error");
    return;
  }

  await ctx.waitForIdle();

  let entry: RuntimeEntry;
  try {
    entry = setEntryEnabled(ctx.cwd, sourcePath, true);
  } catch (error) {
    ctx.ui.notify(
      `Failed to stage extension: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
    return;
  }

  ctx.ui.notify(
    `Enabled ${relative(ctx.cwd, entry.sourcePath) || entry.sourcePath}. Reloading...`,
    "info",
  );

  try {
    setReloading(true);
    await ctx.reload();
    return;
  } catch (error) {
    setReloading(false);
    setEntryEnabled(ctx.cwd, sourcePath, false);
    notifyReloadError(error, ctx);
  }
}

export async function toggleEntry(
  entry: RuntimeEntry,
  ctx: ExtensionCommandContext,
  setReloading: SetReloading,
): Promise<void> {
  await ctx.waitForIdle();

  const nextEnabled = !entry.enabled;
  let next: RuntimeEntry;

  try {
    next = setEntryEnabled(ctx.cwd, entry.sourcePath, nextEnabled);
  } catch (error) {
    ctx.ui.notify(
      `Failed to ${nextEnabled ? "enable" : "disable"} extension: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
    return;
  }

  ctx.ui.notify(
    `${nextEnabled ? "Enabled" : "Disabled"} ${relative(ctx.cwd, next.sourcePath) || next.sourcePath}. Reloading...`,
    "info",
  );

  try {
    setReloading(true);
    await ctx.reload();
    return;
  } catch (error) {
    setReloading(false);
    const reverted = setEntryEnabled(ctx.cwd, entry.sourcePath, entry.enabled);
    if (!reverted.enabled && reverted.runtimePath) {
      rmSync(reverted.runtimePath, { force: true });
    }
    notifyReloadError(error, ctx);
  }
}

export async function showToggleList(
  ctx: ExtensionCommandContext,
  setReloading: SetReloading,
): Promise<void> {
  const entries = listKnownEntries(ctx.cwd);
  const options = [LOAD_MENU_LABEL, ...entries.map((entry, index) => formatEntryLabel(ctx.cwd, entry, index))];

  const choice = await ctx.ui.select("Dynamic extensions", options);
  if (!choice) {
    return;
  }

  if (choice === LOAD_MENU_LABEL) {
    await enableExtensionFromPath(undefined, ctx, setReloading);
    return;
  }

  const selectedIndex = options.indexOf(choice) - 1;
  if (selectedIndex < 0 || selectedIndex >= entries.length) {
    return;
  }

  await toggleEntry(entries[selectedIndex]!, ctx, setReloading);
}

export async function removeEntry(
  entry: RuntimeEntry,
  ctx: ExtensionCommandContext,
  setReloading: SetReloading,
): Promise<void> {
  await ctx.waitForIdle();

  const removed = removeTrackedEntry(ctx.cwd, entry.sourcePath);
  if (!removed) {
    ctx.ui.notify("Tracked extension not found", "error");
    return;
  }

  ctx.ui.notify(`Removed ${relative(ctx.cwd, entry.sourcePath) || entry.sourcePath}. Reloading...`, "info");

  try {
    setReloading(true);
    await ctx.reload();
    return;
  } catch (error) {
    setReloading(false);
    setEntryEnabled(ctx.cwd, entry.sourcePath, entry.enabled);
    notifyReloadError(error, ctx);
  }
}

export async function showUnloadList(
  ctx: ExtensionCommandContext,
  setReloading: SetReloading,
): Promise<void> {
  const entries = listKnownEntries(ctx.cwd);
  if (entries.length === 0) {
    ctx.ui.notify("No tracked dynamic extensions", "info");
    return;
  }

  const options = entries.map((entry, index) => formatEntryLabel(ctx.cwd, entry, index));
  const choice = await ctx.ui.select("Remove tracked dynamic extension", options);
  if (!choice) {
    return;
  }

  const selectedIndex = options.indexOf(choice);
  if (selectedIndex < 0 || selectedIndex >= entries.length) {
    return;
  }

  await removeEntry(entries[selectedIndex]!, ctx, setReloading);
}
