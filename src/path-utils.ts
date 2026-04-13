import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { DYNAMIC_MANIFEST_FILE, DYNAMIC_RUNTIME_DIR } from "./constants.ts";
import type { RuntimeEntry } from "./types.ts";

export function getPiDir(cwd: string): string {
  return join(cwd, ".pi");
}

export function getExtensionsDir(cwd: string): string {
  return join(getPiDir(cwd), "extensions");
}

export function getManifestPath(cwd: string): string {
  return join(getPiDir(cwd), DYNAMIC_MANIFEST_FILE);
}

export function getRuntimeRootDir(cwd: string): string {
  return join(getPiDir(cwd), DYNAMIC_RUNTIME_DIR);
}

export function getSettingsPath(cwd: string): string {
  return join(getPiDir(cwd), "settings.json");
}

export function resolveProjectSettingPath(cwd: string, settingPath: string): string {
  if (settingPath.startsWith("/")) {
    return settingPath;
  }

  if (settingPath === "~" || settingPath.startsWith("~/") || settingPath.startsWith("~")) {
    return expandTilde(settingPath);
  }

  return resolve(getPiDir(cwd), settingPath);
}

export function expandTilde(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  if (input.startsWith("~")) return join(homedir(), input.slice(1));
  return input;
}

export function parsePath(raw: string): string {
  const trimmed = raw.trim();
  const quoted = trimmed.match(/^"(.*)"$/) || trimmed.match(/^'(.*)'$/);
  if (quoted) return quoted[1] ?? "";
  return trimmed.split(/\s+/)[0] ?? "";
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-z0-9._-]/gi, "_").slice(0, 60);
}

export function getRuntimeEntryBaseName(sourcePath: string): string {
  const fileName = basename(sourcePath);
  if (/^index\.[a-z0-9]+$/i.test(fileName)) {
    return sanitizeName(basename(dirname(sourcePath)) || "extension");
  }

  const extMatch = fileName.match(/^(.*)\.[^.]+$/);
  return sanitizeName(extMatch?.[1] || fileName || "extension");
}

export function formatEntryLabel(cwd: string, entry: RuntimeEntry, index: number): string {
  const state = entry.enabled ? "[on]" : "[off]";
  const source = relative(cwd, entry.sourcePath) || entry.sourcePath;
  return `${index + 1}. ${state} ${source}`;
}
