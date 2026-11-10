import { useEffect, useState } from "react";
import { SettingRow, Toggle } from "../ui/primitives";

export function CommandApprovalSetting() {
  const [always, setAlways] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    window.codeBrainApp.appConfig.get().then(config => {
      if (mounted) setAlways(config.agentCommandApproval === undefined || config.agentCommandApproval === "always");
    }).catch(() => { if (mounted) setError("Não foi possível ler a permissão de comandos."); })
      .finally(() => { if (mounted) setBusy(false); });
    return () => { mounted = false; };
  }, []);
  async function change(value: boolean) {
    setBusy(true); setError("");
    try {
      await window.codeBrainApp.appConfig.set({ agentCommandApproval: value ? "always" : "ask" });
      setAlways(value);
    } catch { setError("Não foi possível salvar a permissão. Tente novamente."); }
    finally { setBusy(false); }
  }
  return <div>
    <SettingRow label="Sempre permitir comandos dos agentes" description="Ligado por padrão. Não abre a confirmação a cada comando, em qualquer harness. Os comandos não têm sandbox do sistema operacional e podem acessar arquivos fora do projeto. Não recebem credenciais do cofre ou dos provedores pelo ambiente; as demais proteções continuam ativas.">
      <Toggle aria-label="Sempre permitir comandos dos agentes" enabled={always} disabled={busy} onChange={change} />
    </SettingRow>
    {error ? <p role="alert" className="cb-help text-cb-danger">{error}</p> : null}
  </div>;
}
