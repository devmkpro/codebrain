/**
 * Universal Harness Driver Architecture for Codebrain.
 *
 * Provides a unified, extensible driver for ANY AI CLI harness:
 * - Declarative driver specification for native and generic harnesses.
 * - Virtual provider resolution (OAuth, session-based, CLI-based).
 * - Standardized protocol adapters (Anthropic-compat, OpenAI-compat, Gemini-compat, MiMo, 9Router).
 * - Canonical model resolution and catalog ordering.
 */

import { CLI_REGISTRY, type HarnessId } from "./cli-registry";
import { PROVIDER_REGISTRY } from "../constants";
import { sortModelIds, type ModelReleaseInfo } from "../../../../src/lib/model-catalog-order";

export const ANTIGRAVITY_CANONICAL_MODELS = [
  "gemini-4-carbon-high",
  "gemini-4-carbon-medium",
  "gemini-4-argon-high",
  "gemini-4-argon-medium",
  "gemini-3.8-flash-high",
  "gemini-3.8-flash-medium",
  "claude-sonnet-4-6",
];

export const KIRO_CANONICAL_MODELS = [
  "claude-haiku-5.5",
  "claude-sonnet-5.5",
  "claude-opus-5.5",
];

export const GROK_CANONICAL_MODELS = [
  "grok-build",
  "grok-build-0.1",
  "grok-4",
];

export interface HarnessDriver {
  harnessId: HarnessId | string;
  virtualProviderId: string;
  label: string;
  type: "oauth" | "cli" | "codex" | "anthropic-compat" | "openai-compat" | "gemini-compat";
  host: string;
  baseUrl?: string;
  tokenEnvVar?: string;
  getCanonicalModels: () => string[];
  filterModels?: (models: string[]) => string[];
}

const NATIVE_PROVIDER_MAP: Record<string, string> = {
  claude: "claude-oauth",
  codex: "codex-oauth",
  kimi: "kimi",
  cursor: "cursor",
  copilot: "copilot",
};

/** Get the virtual provider ID for any harness */
export function providerIdForHarness(harnessId: string): string {
  return NATIVE_PROVIDER_MAP[harnessId] ?? `${harnessId}-cli`;
}

/** Get the harness ID from a virtual provider ID */
export function harnessIdForProvider(providerId: string): string | undefined {
  for (const [harness, pid] of Object.entries(NATIVE_PROVIDER_MAP)) {
    if (pid === providerId) return harness;
  }
  if (providerId.endsWith("-cli")) {
    const candidate = providerId.slice(0, -4);
    if (CLI_REGISTRY.some((entry) => entry.id === candidate)) return candidate;
  }
  const match = CLI_REGISTRY.find((entry) => entry.id === providerId);
  return match?.id;
}

/** Check if a provider ID represents a virtual CLI harness */
export function isVirtualHarnessProvider(providerId: string): boolean {
  if (Object.values(NATIVE_PROVIDER_MAP).includes(providerId)) return true;
  if (providerId === "mimo-claude") return true;
  if (providerId.endsWith("-cli")) {
    const candidate = providerId.slice(0, -4);
    return CLI_REGISTRY.some((entry) => entry.id === candidate);
  }
  return CLI_REGISTRY.some((entry) => entry.id === providerId && entry.id !== "openclaude");
}

function mergeModelCatalogs(...catalogs: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const catalog of catalogs) {
    for (const model of catalog ?? []) {
      const id = model.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
    }
  }
  return merged;
}

export function resolveDriverModels(
  driver: HarnessDriver,
  saved: any,
  canonicalFallback?: string[]
): string[] {
  const canonical = canonicalFallback ?? driver.getCanonicalModels();
  if (saved?.modelsMode === "manual") {
    const raw = mergeModelCatalogs(saved.models);
    const filtered = driver.filterModels ? driver.filterModels(raw) : raw;
    return sortModelIds(filtered, saved.modelsMetadata);
  }
  const raw = saved?.models?.length ? mergeModelCatalogs(saved.models) : canonical;
  const filtered = driver.filterModels ? driver.filterModels(raw) : raw;
  return sortModelIds(filtered.length ? filtered : canonical, saved?.modelsMetadata);
}

/**
 * Universal registry of Harness Drivers.
 * Every CLI harness supported by Codebrain has a clean, declarative driver here.
 */
export const HARNESS_DRIVERS: Record<string, HarnessDriver> = {
  claude: {
    harnessId: "claude",
    virtualProviderId: "claude-oauth",
    label: "Claude",
    type: "oauth",
    host: "claude",
    getCanonicalModels: () => {
      const tpl = PROVIDER_REGISTRY.find((t) => t.id === "claude-oauth");
      return tpl?.models ? [...tpl.models] : [];
    },
    filterModels: (models: string[]) =>
      models.filter((id) => !/^(default|best|opus|sonnet|haiku|fable)(\[1m\])?$/.test(id)),
  },
  codex: {
    harnessId: "codex",
    virtualProviderId: "codex-oauth",
    label: "Codex",
    type: "codex",
    host: "codex",
    getCanonicalModels: () => {
      const tpl = PROVIDER_REGISTRY.find((t) => t.id === "codex-oauth") ??
        PROVIDER_REGISTRY.find((t) => t.id === "codex");
      return tpl?.models ? [...tpl.models] : [];
    },
  },
  antigravity: {
    harnessId: "antigravity",
    virtualProviderId: "antigravity-cli",
    label: "Antigravity CLI",
    type: "cli",
    host: "antigravity",
    getCanonicalModels: () => [...ANTIGRAVITY_CANONICAL_MODELS],
  },
  kiro: {
    harnessId: "kiro",
    virtualProviderId: "kiro-cli",
    label: "Kiro CLI",
    type: "cli",
    host: "kiro",
    getCanonicalModels: () => [...KIRO_CANONICAL_MODELS],
  },
  kimi: {
    harnessId: "kimi",
    virtualProviderId: "kimi",
    label: "Kimi Code",
    type: "openai-compat",
    host: "kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    getCanonicalModels: () => {
      const tpl = PROVIDER_REGISTRY.find((t) => t.id === "kimi");
      return tpl?.models ? [...tpl.models] : ["kimi-k2.6", "kimi-k2.5"];
    },
  },
  cursor: {
    harnessId: "cursor",
    virtualProviderId: "cursor",
    label: "Cursor CLI",
    type: "openai-compat",
    host: "cursor",
    getCanonicalModels: () => {
      const tpl = PROVIDER_REGISTRY.find((t) => t.id === "cursor");
      return tpl?.models ? [...tpl.models] : [];
    },
  },
  copilot: {
    harnessId: "copilot",
    virtualProviderId: "copilot",
    label: "GitHub Copilot",
    type: "openai-compat",
    host: "copilot",
    getCanonicalModels: () => {
      const tpl = PROVIDER_REGISTRY.find((t) => t.id === "copilot");
      return tpl?.models ? [...tpl.models] : [];
    },
  },
  grok: {
    harnessId: "grok",
    virtualProviderId: "grok-cli",
    label: "Grok Build",
    type: "cli",
    host: "grok",
    getCanonicalModels: () => [...GROK_CANONICAL_MODELS],
  },
  opencode: {
    harnessId: "opencode",
    virtualProviderId: "opencode-cli",
    label: "OpenCode",
    type: "cli",
    host: "opencode",
    getCanonicalModels: () => [],
  },
  hermes: {
    harnessId: "hermes",
    virtualProviderId: "hermes-cli",
    label: "Hermes Agent",
    type: "cli",
    host: "hermes",
    getCanonicalModels: () => [],
  },
  muse: {
    harnessId: "muse",
    virtualProviderId: "muse-cli",
    label: "Muse Code",
    type: "cli",
    host: "muse",
    getCanonicalModels: () => [],
  },
  commandcode: {
    harnessId: "commandcode",
    virtualProviderId: "commandcode-cli",
    label: "CommandCode",
    type: "cli",
    host: "commandcode",
    getCanonicalModels: () => [],
  },
};

/** Get the HarnessDriver for a given harness id */
export function getHarnessDriver(harnessId: string): HarnessDriver | undefined {
  return HARNESS_DRIVERS[harnessId];
}

/** Get the HarnessDriver for a given virtual provider id */
export function getDriverByProviderId(providerId: string): HarnessDriver | undefined {
  return Object.values(HARNESS_DRIVERS).find(
    (driver) => driver.virtualProviderId === providerId || driver.harnessId === providerId
  );
}

/**
 * Standardized protocol adapter resolver.
 * When running an API provider (e.g. MiMo, 9Router, DeepSeek) through a CLI harness,
 * this function constructs the appropriate environment variables cleanly.
 */
export function resolveHarnessAdapterEnv(
  targetHarness: string,
  provider: any,
  model?: string
): Record<string, string> {
  const env: Record<string, string> = {};

  // Anthropic protocol on Claude CLI (MiMo, 9Router, self-hosted proxies)
  if (targetHarness === "claude") {
    const token =
      provider.env?.["ANTHROPIC_AUTH_TOKEN"] ||
      provider.env?.["MIMO_API_KEY"] ||
      provider.env?.["ANTHROPIC_API_KEY"] ||
      provider.env?.["OPENAI_API_KEY"] ||
      provider.apiKey ||
      "";
    if (token) {
      env["ANTHROPIC_AUTH_TOKEN"] = token;
      env["MIMO_API_KEY"] = token;
    }
    const baseUrl =
      provider.baseUrl ||
      provider.env?.["ANTHROPIC_BASE_URL"] ||
      (provider.id === "mimo-claude" ? "https://token-plan-ams.xiaomimimo.com/anthropic" : undefined);
    if (baseUrl) {
      env["ANTHROPIC_BASE_URL"] = baseUrl;
    }
  }

  // OpenAI protocol on Codex or OpenClaude
  if (targetHarness === "codex" || targetHarness === "openclaude") {
    const key =
      provider.env?.["OPENAI_API_KEY"] ||
      provider.env?.["ANTHROPIC_AUTH_TOKEN"] ||
      provider.apiKey ||
      "";
    if (key) {
      env["OPENAI_API_KEY"] = key;
    }
    if (provider.baseUrl) {
      env["OPENAI_BASE_URL"] = provider.baseUrl;
    }
  }

  // Model-level overrides
  if (model) {
    env["MODEL"] = model;
    if (targetHarness === "claude" || targetHarness === "openclaude") {
      env["ANTHROPIC_MODEL"] = model;
    }
  }

  return env;
}
