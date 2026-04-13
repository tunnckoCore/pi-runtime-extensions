import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
} from "@mariozechner/pi-coding-agent";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createWorkspace(prefix = "pi-ext-test-") {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  const sourceA = join(cwd, "demo-a.ts");
  const sourceB = join(cwd, "demo-b.ts");

  writeFileSync(sourceA, "export default function () {}\n", "utf-8");
  writeFileSync(sourceB, "export default function () {}\n", "utf-8");

  return {
    cwd,
    sourceA,
    sourceB,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

export async function createEmbeddedHarness(options: {
  cwd: string;
  extensionPath: string;
  onSelect?: (title: string, choices: string[]) => Promise<string | undefined>;
  onInput?: (title: string, placeholder?: string) => Promise<string | undefined>;
}) {
  const notifications: Array<{ message: string; type?: string }> = [];
  const selections: Array<{ title: string; choices: string[] }> = [];
  const inputs: Array<{ title: string; placeholder?: string }> = [];

  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: join(options.cwd, ".pi-agent-test"),
    additionalExtensionPaths: [options.extensionPath],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: options.cwd,
    resourceLoader,
    sessionManager: SessionManager.inMemory(options.cwd),
  });

  const uiContext = {
    async select(title: string, choices: string[]) {
      selections.push({ title, choices });
      return (await options.onSelect?.(title, choices)) ?? undefined;
    },
    async confirm() {
      return true;
    },
    async input(title: string, placeholder?: string) {
      inputs.push({ title, placeholder });
      return (await options.onInput?.(title, placeholder)) ?? undefined;
    },
    notify(message: string, type?: "info" | "warning" | "error") {
      notifications.push({ message, type });
    },
    onTerminalInput() {
      return () => {};
    },
    setStatus() {},
    setWorkingMessage() {},
    setHiddenThinkingLabel() {},
    setWidget() {},
    setFooter() {},
    setHeader() {},
    setTitle() {},
    async custom() {
      return undefined;
    },
    pasteToEditor() {},
    setEditorText() {},
    getEditorText() {
      return "";
    },
    async editor() {
      return undefined;
    },
    setEditorComponent() {},
    theme: {},
    getAllThemes() {
      return [];
    },
    getTheme() {
      return undefined;
    },
    setTheme() {
      return { success: false, error: "not supported in tests" };
    },
    getToolsExpanded() {
      return false;
    },
    setToolsExpanded() {},
  };

  await session.bindExtensions({
    uiContext: uiContext as any,
    commandContextActions: {
      waitForIdle: async () => {
        await session.agent.waitForIdle();
      },
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async () => ({ cancelled: true }),
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {
        await session.reload();
      },
    },
  });

  return {
    session,
    notifications,
    selections,
    inputs,
    async shutdown() {
      await session.extensionRunner?.emit({ type: "session_shutdown" });
    },
    dispose() {
      session.dispose();
    },
  };
}
