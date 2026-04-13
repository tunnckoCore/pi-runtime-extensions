import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function renderAlignedLine(left: string, right: string, width: number): string {
  let safeLeft = left;
  let leftWidth = visibleWidth(safeLeft);
  if (leftWidth > width) {
    safeLeft = truncateToWidth(safeLeft, width, "...");
    leftWidth = visibleWidth(safeLeft);
  }

  const minPadding = right ? 2 : 0;
  const rightWidth = visibleWidth(right);
  const totalNeeded = leftWidth + minPadding + rightWidth;

  if (!right || totalNeeded <= width) {
    const padding = right ? " ".repeat(Math.max(minPadding, width - leftWidth - rightWidth)) : "";
    return safeLeft + padding + right;
  }

  const availableForRight = width - leftWidth - minPadding;
  if (availableForRight > 0) {
    const truncatedRight = truncateToWidth(right, availableForRight, "");
    const truncatedRightWidth = visibleWidth(truncatedRight);
    const padding = " ".repeat(Math.max(minPadding, width - leftWidth - truncatedRightWidth));
    return safeLeft + padding + truncatedRight;
  }

  return safeLeft;
}

function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function readJson(path: string): any {
  try {
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function resolveAutoCompactionEnabled(cwd: string): boolean {
  const home = process.env.HOME || process.env.USERPROFILE;
  const globalSettings = home
    ? readJson(join(home, ".pi", "agent", "settings.json"))
    : undefined;
  const projectSettings = readJson(join(cwd, ".pi", "settings.json"));

  const globalEnabled = globalSettings?.compaction?.enabled;
  const projectEnabled = projectSettings?.compaction?.enabled;

  if (typeof projectEnabled === "boolean") return projectEnabled;
  if (typeof globalEnabled === "boolean") return globalEnabled;
  return true;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const autoCompactEnabled = resolveAutoCompactionEnabled(ctx.cwd);

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          let totalInput = 0;
          let totalOutput = 0;
          let totalCacheRead = 0;
          let totalCacheWrite = 0;
          let totalCost = 0;

          for (const entry of ctx.sessionManager.getEntries()) {
            if (entry.type === "message" && entry.message.role === "assistant") {
              const message = entry.message as AssistantMessage;
              totalInput += message.usage.input;
              totalOutput += message.usage.output;
              totalCacheRead += message.usage.cacheRead;
              totalCacheWrite += message.usage.cacheWrite;
              totalCost += message.usage.cost.total;
            }
          }

          const contextUsage = ctx.getContextUsage();
          const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const contextPercentValue = contextUsage?.percent ?? 0;
          const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

          let pwd = ctx.sessionManager.getCwd();
          const home = process.env.HOME || process.env.USERPROFILE;
          if (home && pwd.startsWith(home)) {
            pwd = `~${pwd.slice(home.length)}`;
          }

          const branch = footerData.getGitBranch();
          if (branch) {
            pwd = `${pwd} (${branch})`;
          }

          const sessionName = ctx.sessionManager.getSessionName();
          if (sessionName) {
            pwd = `${pwd} • ${sessionName}`;
          }

          const statsParts: string[] = [];
          if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
          if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
          if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
          if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);

          const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
          if (totalCost || usingSubscription) {
            statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
          }

          const autoIndicator = autoCompactEnabled ? " (auto)" : "";
          const contextPercentDisplay =
            contextPercent === "?"
              ? `?/${formatTokens(contextWindow)}${autoIndicator}`
              : `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;

          let contextPercentStr: string;
          if (contextPercentValue > 90) {
            contextPercentStr = theme.fg("error", contextPercentDisplay);
          } else if (contextPercentValue > 70) {
            contextPercentStr = theme.fg("warning", contextPercentDisplay);
          } else {
            contextPercentStr = contextPercentDisplay;
          }
          statsParts.push(contextPercentStr);

          const statsLeft = statsParts.join(" ");

          const modelName = ctx.model?.id || "no-model";
          let rightSideWithoutProvider = modelName;
          if (ctx.model?.reasoning) {
            const thinkingLevel = pi.getThinkingLevel() || "off";
            rightSideWithoutProvider =
              thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
          }

          let rightSide = rightSideWithoutProvider;
          if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
            rightSide = `(${ctx.model.provider}) ${rightSideWithoutProvider}`;
            if (visibleWidth(pwd) + 2 + visibleWidth(rightSide) > width) {
              rightSide = rightSideWithoutProvider;
            }
          }

          const pwdLine = renderAlignedLine(theme.fg("dim", pwd), theme.fg("dim", rightSide), width);
          const statsLine = renderAlignedLine(
            theme.fg("dim", statsLeft),
            theme.fg("dim", ctx.sessionManager.getSessionId()),
            width,
          );

          const lines = [pwdLine, statsLine];

          const extensionStatuses = footerData.getExtensionStatuses();
          if (extensionStatuses.size > 0) {
            const sortedStatuses = Array.from(extensionStatuses.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, text]) => sanitizeStatusText(text));
            const statusLine = sortedStatuses.join(" ");
            lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
          }

          return lines;
        },
      };
    });
  });
}
