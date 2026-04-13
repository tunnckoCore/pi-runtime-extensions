import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCommands } from "./commands.ts";
import { clearSessionRuntimeEntries, listKnownEntries } from "./manifest-store.ts";

export function createDynamicExtension() {
  let processCleanupInstalled = false;
  let isReloading = false;
  const activeRoots = new Set<string>();

  function installExitCleanup(): void {
    if (processCleanupInstalled) return;
    processCleanupInstalled = true;

    process.once("exit", () => {
      for (const cwd of activeRoots) {
        clearSessionRuntimeEntries(cwd);
      }
    });
  }

  return function dynamicExtension(pi: ExtensionAPI): void {
    installExitCleanup();

    pi.on("session_start", async (_event, ctx) => {
      activeRoots.add(ctx.cwd);

      const entries = listKnownEntries(ctx.cwd);
      if (entries.length > 0) {
        const enabledCount = entries.filter((entry) => entry.enabled).length;
        ctx.ui.notify(
          `Dynamic extensions: ${enabledCount} enabled / ${entries.length} tracked`,
          "info",
        );
      }
    });

    pi.on("session_shutdown", async (_event, ctx) => {
      if (isReloading) {
        isReloading = false;
        return;
      }

      clearSessionRuntimeEntries(ctx.cwd);
      activeRoots.delete(ctx.cwd);
    });

    registerCommands(pi, (value) => {
      isReloading = value;
    });
  };
}

export default createDynamicExtension();
