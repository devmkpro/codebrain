/**
 * Squad presets — ready-made team compositions for the "+ time" launcher.
 *
 * A preset names the *intent* (an Opus orchestrator delegating to Codex
 * workers), not hard-coded provider ids: those depend on which providers the
 * user actually configured. The resolver below maps the intent onto whatever is
 * installed and degrades gracefully when a preferred provider is missing, so
 * the wizard always opens pre-filled and editable rather than empty or broken.
 */

export interface PresetProvider {
  id: string;
  label?: string;
  models?: string[];
}

export interface PresetSlot {
  providerId: string;
  model: string;
}

export interface PresetWorkerSlot extends PresetSlot {
  id: string;
  role: string;
}

export interface ResolvedSquadPreset {
  name: string;
  orchestrator: PresetSlot;
  workers: PresetWorkerSlot[];
  /** Slots that fell back because the preferred provider or model was absent. */
  warnings: string[];
}

export interface SquadPresetRole {
  /** Worker role label shown in the wizard; "tester" maps to the ui-tester prompt. */
  role: string;
}

export interface SquadPreset {
  id: string;
  label: string;
  description: string;
  /** Provider ids to try in order for the orchestrator. */
  orchestratorProviders: string[];
  /** Model ids to try in order, then `orchestratorModelPattern` as a fallback. */
  orchestratorModels: string[];
  orchestratorModelPattern: RegExp;
  workerProviders: string[];
  workerModels: string[];
  workerModelPattern: RegExp;
  workers: SquadPresetRole[];
}

/**
 * Default team: Claude Opus plans and delegates, Codex gpt-5.6-terra builds.
 * Opus never writes files (see native-tools.ts), so the expensive model is only
 * spent on planning while the cheaper workers do the edits.
 */
export const CLAUDE_CODEX_PRESET: SquadPreset = {
  id: "claude-codex",
  label: "Opus + Codex",
  description: "Opus orquestra, workers Codex executam",
  orchestratorProviders: ["claude-oauth", "anthropic", "mimo-claude"],
  orchestratorModels: ["claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6"],
  orchestratorModelPattern: /opus/i,
  workerProviders: ["codex-oauth", "codex"],
  workerModels: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"],
  workerModelPattern: /^gpt-5\.6/i,
  workers: [{ role: "backend" }, { role: "frontend" }, { role: "tester" }],
};

export const SQUAD_PRESETS: SquadPreset[] = [CLAUDE_CODEX_PRESET];

function pickProvider(
  providers: PresetProvider[],
  preferredIds: string[],
  modelPattern: RegExp
): PresetProvider | undefined {
  for (const id of preferredIds) {
    const hit = providers.find((p) => p.id === id && (p.models?.length ?? 0) > 0);
    if (hit) return hit;
  }
  // No preferred provider configured — any provider offering a matching model
  // is a better fallback than an arbitrary one.
  return (
    providers.find((p) => p.models?.some((m) => modelPattern.test(m))) ??
    providers.find((p) => (p.models?.length ?? 0) > 0)
  );
}

function pickModel(
  provider: PresetProvider | undefined,
  preferredModels: string[],
  modelPattern: RegExp
): string {
  const models = provider?.models ?? [];
  for (const model of preferredModels) {
    if (models.includes(model)) return model;
  }
  return models.find((m) => modelPattern.test(m)) ?? models[0] ?? "";
}

let workerSeq = 0;
/** Injectable so tests get stable ids. */
export function resetPresetIds(): void {
  workerSeq = 0;
}

/**
 * Maps a preset onto the user's configured providers.
 *
 * Returns `null` when no provider has any model — the caller should send the
 * user to the providers screen instead of opening an unusable wizard.
 */
export function resolveSquadPreset(
  preset: SquadPreset,
  providers: PresetProvider[]
): ResolvedSquadPreset | null {
  const usable = (providers ?? []).filter((p) => (p.models?.length ?? 0) > 0);
  if (usable.length === 0) return null;

  const warnings: string[] = [];

  const orchestratorProvider = pickProvider(
    usable,
    preset.orchestratorProviders,
    preset.orchestratorModelPattern
  );
  const orchestratorModel = pickModel(
    orchestratorProvider,
    preset.orchestratorModels,
    preset.orchestratorModelPattern
  );
  if (orchestratorProvider && !preset.orchestratorProviders.includes(orchestratorProvider.id)) {
    warnings.push(
      `Nenhum provider Claude configurado — orquestrador usando ${orchestratorProvider.label ?? orchestratorProvider.id}.`
    );
  }

  const workerProvider = pickProvider(usable, preset.workerProviders, preset.workerModelPattern);
  const workerModel = pickModel(workerProvider, preset.workerModels, preset.workerModelPattern);
  if (workerProvider && !preset.workerProviders.includes(workerProvider.id)) {
    warnings.push(
      `Nenhum provider Codex configurado — workers usando ${workerProvider.label ?? workerProvider.id}.`
    );
  }

  return {
    name: preset.label,
    orchestrator: {
      providerId: orchestratorProvider?.id ?? "",
      model: orchestratorModel,
    },
    workers: preset.workers.map(({ role }) => ({
      id: `preset-${++workerSeq}`,
      role,
      providerId: workerProvider?.id ?? "",
      model: workerModel,
    })),
    warnings,
  };
}
