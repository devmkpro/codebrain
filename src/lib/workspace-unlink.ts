export interface WorkspaceUnlinkResult {
  ok?: boolean;
  error?: string;
}

/**
 * IPC responses can be absent while an Electron window is still using an old
 * preload bundle. Keep that failure actionable instead of dereferencing `.ok`.
 */
export function ensureWorkspaceUnlinked(result: WorkspaceUnlinkResult | null | undefined): void {
  if (result?.ok) return;
  throw new Error(
    result?.error
      || "O serviço de workspaces não respondeu. Reinicie o Codebrain e tente novamente.",
  );
}
