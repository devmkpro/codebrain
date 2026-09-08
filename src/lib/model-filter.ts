/**
 * Shared filtering for provider and model pickers.
 *
 * OpenRouter alone exposes ~300 models, so every picker that can show a long
 * catalogue needs the same matching rules. Keeping them here means the pane
 * launcher, the squad wizard and Libre mode all behave identically.
 */

/**
 * Models and providers are written with mixed separators — `anthropic/claude-opus-4`,
 * `gpt-5.6-terra`, `accounts/fireworks/models/kimi-k2-instruct`. Collapsing them
 * to spaces lets "claude opus 4" and "claude-opus-4" match the same entry.
 */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[/_.-]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Every whitespace-separated term in `query` must appear somewhere in the
 * haystack. Order does not matter, so "opus anthropic" finds
 * "anthropic/claude-opus-4" just as well as "anthropic opus".
 */
export function matchesQuery(query: string, ...haystack: (string | undefined)[]): boolean {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const target = normalize(haystack.filter(Boolean).join(" "));
  return terms.every((term) => target.includes(term));
}

export function filterModels(models: readonly string[], query: string): string[] {
  if (!query.trim()) return [...models];
  return models.filter((model) => matchesQuery(query, model));
}

export interface FilterableProvider {
  id: string;
  label?: string;
  host?: string;
  models?: string[];
}

/**
 * Providers match on their own name and on the models they carry, so searching
 * "opus" from the provider step surfaces every provider that can run it.
 */
export function filterProviders<T extends FilterableProvider>(providers: readonly T[], query: string): T[] {
  if (!query.trim()) return [...providers];
  return providers.filter(
    (provider) =>
      matchesQuery(query, provider.label, provider.id, provider.host) ||
      (provider.models ?? []).some((model) => matchesQuery(query, model))
  );
}
