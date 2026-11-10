export interface ModelReleaseInfo {
  id: string;
  created?: unknown;
  created_at?: unknown;
  release_date?: unknown;
  releaseDate?: unknown;
  release?: unknown;
  date?: unknown;
}

function timestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return value < 100_000_000_000 ? value * 1000 : value;
  if (typeof value !== "string" || !value.trim()) return null;
  if (/^\d{10,13}$/.test(value)) return timestamp(Number(value));
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function release(info: ModelReleaseInfo | undefined, id: string): number | null {
  for (const value of [
    info?.created,
    info?.created_at,
    info?.release_date,
    info?.releaseDate,
    info?.release,
    info?.date,
  ]) {
    const at = timestamp(value);
    if (at !== null) return at;
  }
  const date = id.match(/(?:^|[-_])(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)(?:$|[-_])/);
  return date ? timestamp(`${date[1]}-${date[2]}-${date[3]}`) : null;
}

/** Source dates win; semantic numeric components are the fallback, never a
 * lexical comparison (5.10 is newer than 5.9). Unversioned aliases stay last
 * in their original order: "auto" and "opus" are not release dates. */
export function sortModelIds(
  ids: readonly string[] = [],
  metadata: readonly ModelReleaseInfo[] = []
): string[] {
  const byId = new Map(metadata.map((entry) => [entry.id, entry]));
  const unique = [
    ...new Set(ids.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())),
  ];
  const rows = unique.map((id, index) => ({
    id,
    index,
    at: release(byId.get(id), id),
    sourceAt: release(byId.get(id), ""),
    alias: /(?:^|\/)(?:auto|default|latest|best|fast|balanced|deep|opus|sonnet|haiku|fable)$/i.test(
      id
    ),
    version: [...id.replace(/20\d{6}/g, "").matchAll(/\d+(?:\.\d+)*/g)].flatMap((match) =>
      match[0].split(".").map(Number)
    ),
  }));
  rows.sort((a, b) => {
    const undatedA = a.alias || (a.at === null && !a.version.length);
    const undatedB = b.alias || (b.at === null && !b.version.length);
    if (undatedA !== undatedB) return undatedA ? 1 : -1;
    if (undatedA && undatedB) return a.index - b.index;
    // An old timestamp suffix is not proof that it is newer than a versioned
    // sibling which has no date suffix. Actual source metadata still wins.
    const useVersions = a.sourceAt === null && b.sourceAt === null && a.version.length && b.version.length && (a.at === null || b.at === null);
    if ((a.at !== null || b.at !== null) && !useVersions) {
      if (a.at === null) return 1;
      if (b.at === null) return -1;
      if (a.at !== b.at) return b.at - a.at;
    }
    if (a.version.length || b.version.length) {
      if (!a.version.length) return 1;
      if (!b.version.length) return -1;
      for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
        const difference = (b.version[i] ?? 0) - (a.version[i] ?? 0);
        if (difference) return difference;
      }
    }
    return a.index - b.index;
  });
  return rows.map((row) => row.id);
}
