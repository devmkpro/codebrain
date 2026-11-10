import React from "react";
import { Badge, Button } from "../ui/primitives";

type Harness = { id: string; label: string; found: boolean; version?: string; verified: boolean };

/** Detecta ao abrir o tour e ao voltar à janela, inclusive após instalar uma CLI fora do app. */
export function HarnessDetection() {
  const [entries, setEntries] = React.useState<Harness[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const refreshRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    let disposed = false;
    let running = false;
    const refresh = async () => {
      if (running || disposed) return;
      running = true;
      setLoading(true);
      setError(null);
      try {
        const cli = window.codeBrainApp?.cli;
        if (!cli?.registry)
          throw new Error("A detecção de harnesses não está disponível nesta versão.");
        await cli.redetect?.();
        const registry = await cli.registry();
        if (!Array.isArray(registry))
          throw new Error("O registro de harnesses retornou uma resposta inválida.");
        if (!disposed) setEntries(registry);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      } finally {
        running = false;
        if (!disposed) setLoading(false);
      }
    };
    refreshRef.current = () => {
      void refresh();
    };
    void refresh();
    window.addEventListener("focus", refreshRef.current);
    return () => {
      disposed = true;
      window.removeEventListener("focus", refreshRef.current);
    };
  }, []);

  const installed = entries.filter((entry) => entry.found);
  return (
    <section
      className="px-4 py-3 border-b border-cb-line-0 bg-cb-bg-inset shrink-0"
      aria-label="Harnesses locais"
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="cb-label">harnesses locais</span>
        <span className="text-xs text-cb-fg-2" role="status">
          {loading
            ? "Detectando automaticamente…"
            : error
              ? "Não foi possível atualizar a detecção."
              : `${installed.length} de ${entries.length} detectados`}
        </span>
      </div>
      {installed.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {installed.map((entry) => (
            <Badge key={entry.id} tone={entry.verified ? "success" : "warn"} title={entry.version}>
              {entry.label}
              {entry.verified ? "" : " · experimental"}
            </Badge>
          ))}
        </div>
      )}
      {error ? (
        <div className="flex items-center gap-2 mt-2">
          <p className="text-xs text-cb-danger" role="alert">
            {error}
          </p>
          <Button size="sm" onClick={() => refreshRef.current()}>
            tentar novamente
          </Button>
        </div>
      ) : (
        !loading && (
          <p className="text-xs text-cb-fg-2 mt-1">
            {installed.length
              ? "Executável detectado; o login e os limites são conferidos pela própria CLI."
              : "Nenhum executável encontrado. Instale uma CLI e volte à janela; a detecção será refeita automaticamente."}
          </p>
        )
      )}
    </section>
  );
}
