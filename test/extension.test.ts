import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { listKnownEntries, readManifest } from "../src/manifest-store.ts";
import { getManifestPath, formatEntryLabel } from "../src/path-utils.ts";
import { createEmbeddedHarness, createWorkspace } from "./helpers.ts";

const extensionPath = resolve(import.meta.dir, "../src/index.ts");

test("embedded Pi loads the extension and registers ext:* commands", async () => {
  const workspace = createWorkspace();

  try {
    const harness = await createEmbeddedHarness({
      cwd: workspace.cwd,
      extensionPath,
    });

    expect(existsSync(getManifestPath(workspace.cwd))).toBe(false);

    const commands =
      harness.session.extensionRunner?.getRegisteredCommands() ?? [];
    const names = commands.map((command) => command.invocationName);

    expect(names).toContain("ext:load");
    expect(names).toContain("ext:unload");
    expect(names).toContain("ext:list");
    expect(names.some((name) => name.includes("ext_load"))).toBe(false);
    expect(names.some((name) => name.includes("ext_unload"))).toBe(false);
    expect(names.some((name) => name.includes("ext_list"))).toBe(false);

    harness.dispose();
  } finally {
    workspace.cleanup();
  }
});

test("embedded /ext:load stages a runtime wrapper directory and survives its internal reload", async () => {
  const workspace = createWorkspace();

  try {
    const harness = await createEmbeddedHarness({
      cwd: workspace.cwd,
      extensionPath,
    });

    await harness.session.prompt(`/ext:load ${workspace.sourceA}`);

    const entries = listKnownEntries(workspace.cwd);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sourcePath).toBe(workspace.sourceA);
    expect(entries[0]?.enabled).toBe(true);
    expect(existsSync(entries[0]?.runtimePath!)).toBe(true);
    expect(existsSync(join(entries[0]?.runtimePath!, "index.ts"))).toBe(true);
    expect(
      harness.notifications.some((item) =>
        item.message.includes("Enabled demo-a.ts"),
      ),
    ).toBe(true);
    expect(
      harness.notifications.some((item) =>
        item.message.includes("1 enabled / 1 tracked"),
      ),
    ).toBe(true);

    harness.dispose();
  } finally {
    workspace.cleanup();
  }
});

test("embedded /ext:list toggles an enabled extension off but keeps it tracked", async () => {
  const workspace = createWorkspace();

  try {
    const boot = await createEmbeddedHarness({
      cwd: workspace.cwd,
      extensionPath,
    });
    await boot.session.prompt(`/ext:load ${workspace.sourceA}`);
    boot.dispose();

    const label = formatEntryLabel(
      workspace.cwd,
      listKnownEntries(workspace.cwd)[0]!,
      0,
    );
    const harness = await createEmbeddedHarness({
      cwd: workspace.cwd,
      extensionPath,
      onSelect: async () => label,
    });

    await harness.session.prompt("/ext:list");

    const entries = listKnownEntries(workspace.cwd);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sourcePath).toBe(workspace.sourceA);
    expect(entries[0]?.enabled).toBe(false);
    expect(entries[0]?.runtimePath).toBeUndefined();
    expect(
      harness.selections[0]?.choices.some((choice) =>
        choice.includes("[on] demo-a.ts"),
      ),
    ).toBe(true);

    harness.dispose();
  } finally {
    workspace.cleanup();
  }
});

test("embedded /ext:list can toggle an off entry back on", async () => {
  const workspace = createWorkspace();

  try {
    const first = await createEmbeddedHarness({
      cwd: workspace.cwd,
      extensionPath,
    });
    await first.session.prompt(`/ext:load ${workspace.sourceA}`);
    first.dispose();

    const onLabel = formatEntryLabel(
      workspace.cwd,
      listKnownEntries(workspace.cwd)[0]!,
      0,
    );
    const second = await createEmbeddedHarness({
      cwd: workspace.cwd,
      extensionPath,
      onSelect: async () => onLabel,
    });
    await second.session.prompt("/ext:list");
    second.dispose();

    const offLabel = formatEntryLabel(
      workspace.cwd,
      listKnownEntries(workspace.cwd)[0]!,
      0,
    );
    const third = await createEmbeddedHarness({
      cwd: workspace.cwd,
      extensionPath,
      onSelect: async () => offLabel,
    });
    await third.session.prompt("/ext:list");

    const entries = listKnownEntries(workspace.cwd);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.enabled).toBe(true);
    expect(existsSync(entries[0]?.runtimePath!)).toBe(true);

    third.dispose();
  } finally {
    workspace.cleanup();
  }
});

test("embedded /ext:unload removes the selected tracked entry", async () => {
  const workspace = createWorkspace();

  try {
    const first = await createEmbeddedHarness({
      cwd: workspace.cwd,
      extensionPath,
    });
    await first.session.prompt(`/ext:load ${workspace.sourceA}`);
    first.dispose();

    const toggleOffLabel = formatEntryLabel(
      workspace.cwd,
      listKnownEntries(workspace.cwd)[0]!,
      0,
    );
    const second = await createEmbeddedHarness({
      cwd: workspace.cwd,
      extensionPath,
      onSelect: async () => toggleOffLabel,
    });
    await second.session.prompt("/ext:list");
    second.dispose();

    const third = await createEmbeddedHarness({
      cwd: workspace.cwd,
      extensionPath,
    });
    await third.session.prompt(`/ext:load ${workspace.sourceB}`);
    third.dispose();

    let seenChoices: string[] = [];
    const fourth = await createEmbeddedHarness({
      cwd: workspace.cwd,
      extensionPath,
      onSelect: async (_title, choices) => {
        seenChoices = choices;
        return choices[0];
      },
    });

    await fourth.session.prompt("/ext:unload");

    expect(seenChoices.some((choice) => choice.includes("demo-a.ts"))).toBe(
      true,
    );
    expect(seenChoices.some((choice) => choice.includes("demo-b.ts"))).toBe(
      true,
    );

    const entries = listKnownEntries(workspace.cwd);
    const entryA = entries.find(
      (entry) => entry.sourcePath === workspace.sourceA,
    );
    const entryB = entries.find(
      (entry) => entry.sourcePath === workspace.sourceB,
    );

    expect(entryA).toBeUndefined();
    expect(entryB?.enabled).toBe(true);

    fourth.dispose();
  } finally {
    workspace.cleanup();
  }
});

test("embedded /ext:load preserves existing unrelated .pi/extensions content", async () => {
  const workspace = createWorkspace();

  try {
    const unrelatedDir = join(workspace.cwd, ".pi", "extensions", "existing-ext");
    mkdirSync(unrelatedDir, { recursive: true });
    writeFileSync(join(unrelatedDir, "index.ts"), "export default function () {}\n", "utf-8");

    const harness = await createEmbeddedHarness({
      cwd: workspace.cwd,
      extensionPath,
    });

    await harness.session.prompt(`/ext:load ${workspace.sourceA}`);
    await harness.shutdown();

    expect(existsSync(unrelatedDir)).toBe(true);
    expect(existsSync(join(unrelatedDir, "index.ts"))).toBe(true);
    expect(existsSync(getManifestPath(workspace.cwd))).toBe(false);
    expect(readManifest(workspace.cwd).entries).toHaveLength(0);

    harness.dispose();
  } finally {
    workspace.cleanup();
  }
});

test("embedded /ext:load can activate an extension that imports sibling files", async () => {
  const workspace = createWorkspace();

  try {
    const fixtureDir = join(workspace.cwd, "fixture-ext");
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(join(fixtureDir, "helper.ts"), "export const helper = \"ok\";\n", "utf-8");
    writeFileSync(
      join(fixtureDir, "entry.ts"),
      [
        'import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";',
        'import { helper } from "./helper.ts";',
        '',
        'export default function (pi: ExtensionAPI) {',
        '  pi.registerCommand("fixture:ping", {',
        '    description: "fixture command",',
        '    handler: async (_args, ctx) => {',
        '      ctx.ui.notify(`fixture ${helper}`, "info");',
        '    },',
        '  });',
        '}',
        '',
      ].join("\n"),
      "utf-8",
    );

    const harness = await createEmbeddedHarness({
      cwd: workspace.cwd,
      extensionPath,
    });

    await harness.session.prompt(`/ext:load ${join(fixtureDir, "entry.ts")}`);

    const commands = harness.session.extensionRunner?.getRegisteredCommands() ?? [];
    const names = commands.map((command) => command.invocationName);
    expect(names).toContain("fixture:ping");

    await harness.session.prompt("/fixture:ping");
    expect(harness.notifications.some((item) => item.message.includes("fixture ok"))).toBe(true);

    harness.dispose();
  } finally {
    workspace.cleanup();
  }
});

test("embedded session_shutdown cleans runtime files and clears tracked entries", async () => {
  const workspace = createWorkspace();

  try {
    const harness = await createEmbeddedHarness({
      cwd: workspace.cwd,
      extensionPath,
    });

    await harness.session.prompt(`/ext:load ${workspace.sourceA}`);

    const before = listKnownEntries(workspace.cwd);
    expect(before).toHaveLength(1);
    expect(existsSync(before[0]?.runtimePath!)).toBe(true);

    await harness.shutdown();

    expect(existsSync(getManifestPath(workspace.cwd))).toBe(false);
    expect(readManifest(workspace.cwd).entries).toHaveLength(0);
    expect(existsSync(before[0]?.runtimePath!)).toBe(false);

    harness.dispose();
  } finally {
    workspace.cleanup();
  }
});
