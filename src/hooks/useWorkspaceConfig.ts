import React from "react";

export function useFavoritePane(activeWorkspace: string | undefined) {
  const [favoritePane, setFavoritePane] = React.useState<any>(null);

  React.useEffect(() => {
    if (!activeWorkspace) { setFavoritePane(null); return; }
    let cancelled = false;
    window.codeBrainApp?.workspaceConfig?.get(activeWorkspace).then(cfg => {
      if (!cancelled) setFavoritePane(cfg?.favoritePane ?? null);
    }).catch(() => { if (!cancelled) setFavoritePane(null); });
    return () => { cancelled = true; };
  }, [activeWorkspace]);

  return { favoritePane };
}

export function useClickOutside(ref: React.RefObject<HTMLElement>, isOpen: boolean, onClose: () => void) {
  React.useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, ref, onClose]);
}
