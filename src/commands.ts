import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
  enableExtensionFromPath,
  showToggleList,
  showUnloadList,
  type SetReloading,
} from "./command-actions.ts";

function registerCommand(
  pi: ExtensionAPI,
  name: string,
  description: string,
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>,
): void {
  pi.registerCommand(name, { description, handler });
}

export function registerCommands(pi: ExtensionAPI, setReloading: SetReloading): void {
  const loadHandler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    await enableExtensionFromPath(args, ctx, setReloading);
  };

  const unloadHandler = async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
    await showUnloadList(ctx, setReloading);
  };

  const listHandler = async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
    await showToggleList(ctx, setReloading);
  };

  registerCommand(pi, "ext:load", "Load or re-enable a temp extension for this session", loadHandler);
  registerCommand(pi, "ext:unload", "Remove a tracked runtime extension", unloadHandler);
  registerCommand(pi, "ext:list", "Toggle temp extensions for this session", listHandler);
}
