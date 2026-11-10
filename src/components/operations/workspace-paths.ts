function key(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Old persisted tabs alone must not make an unregistered project discoverable. */
export function operationWorkspacePaths(registered: string[], active?: string | null): string[] {
  const paths = new Map<string, string>();
  for (const path of [...registered, ...(active ? [active] : [])]) {
    if (path) paths.set(key(path), path);
  }
  return [...paths.values()];
}
