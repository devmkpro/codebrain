import React from "react";
import { nanoid } from "nanoid";
import { ChevronLeft, KeyRound, X$1 } from "../../stores/providers-store";
import { DEFAULT_MIMO_ANTHROPIC_BASE_URL, fetchModelsFromEndpoint, normalizeBaseUrl, isValidHttpBaseUrl, resolveIntegrationBaseUrl } from "../../stores/browser-store";

// ProvidersModal
import { useProvidersStore } from "../../stores/providers-store";
import { ProviderList } from "./ProviderList";
import { TemplatePicker } from "./TemplatePicker";
import { BulkTokenForm } from "./BulkTokenForm";
import { ConfiguredTemplateView } from "./ConfiguredTemplateView";
import { ProviderForm } from "./ProviderForm";
export function ProvidersModal({
  open,
  onClose,
  initialStep = "list",
  initialProvider
}) {
  const providers = useProvidersStore(s => s.providers);
  const load = useProvidersStore(s => s.load);
  const save = useProvidersStore(s => s.save);
  const remove = useProvidersStore(s => s.remove);
  const [step, setStep] = React.useState("list");
  const [templates, setTemplates] = React.useState([]);
  const [editing, setEditing] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [bulkTemplate, setBulkTemplate] = React.useState(null);
  const [bulkToken, setBulkToken] = React.useState("");
  const [bulkAnthropicBaseUrl, setBulkAnthropicBaseUrl] = React.useState("");
  const [bulkSaving, setBulkSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState(null);
  React.useEffect(() => {
    if (!open) return;
    load();
    window.codeBrainApp?.providers?.templates?.().then(setTemplates).catch(() => {});
    if (initialProvider) {
      setEditing({
        ...initialProvider,
        env: {
          ...(initialProvider.env ?? {})
        }
      });
      setStep("form");
    } else {
      setStep(initialStep);
      setEditing(null);
      setBulkTemplate(null);
      setBulkToken("");
      setBulkAnthropicBaseUrl(initialStep === "pickTemplate" ? DEFAULT_MIMO_ANTHROPIC_BASE_URL : "");
    }
    setError(null);
  }, [open, load, initialStep, initialProvider]);
  if (!open) return null;
  const startEdit = p => {
    setEditing({
      ...p,
      env: {
        ...(p.env ?? {})
      }
    });
    setError(null);
    setStep("form");
  };
  const pickTemplate = (template, integration) => {
    const env = {};
    if (integration.type === "anthropic-compat" || integration.type === "mimo-compat") {
      env.ANTHROPIC_BASE_URL = integration.baseUrl;
      env[integration.tokenEnvVar] = "";
    } else if (integration.type === "gemini-compat") {
      env.GEMINI_BASE_URL = integration.baseUrl;
      env[integration.tokenEnvVar] = "";
    } else if (integration.type === "openai-compat") {
      env.OPENAI_BASE_URL = integration.baseUrl;
      env[integration.tokenEnvVar] = "";
    }
    const labelSuffix = integration.label ? ` (${integration.label.replace(/^via /, "")})` : "";
    setEditing({
      id: `${template.id}-${nanoid(6)}`,
      label: `${template.label}${labelSuffix}`,
      type: integration.type,
      host: integration.host,
      env,
      models: [...integration.models]
    });
    setError(null);
    setStep("form");
  };
  const pickTemplateDirect = template => {
    setBulkTemplate(template);
    setBulkToken("");
    const existingAnthropic = providers.find(p => p.id.startsWith(`${template.id}-`) && (p.type === "anthropic-compat" || p.type === "mimo-compat"));
    const defaultAnthropicUrl = template.integrations.find(i => i.type === "anthropic-compat" || i.type === "mimo-compat")?.baseUrl ?? "";
    const existingUrl = existingAnthropic?.env?.ANTHROPIC_BASE_URL ?? "";
    if (template.id === "mimo") {
      setBulkAnthropicBaseUrl(existingUrl || defaultAnthropicUrl || DEFAULT_MIMO_ANTHROPIC_BASE_URL);
    } else if (template.id === "9router") {
      // 9Router: seed with the saved instance URL (self-host or remote) or template default
      setBulkAnthropicBaseUrl(existingUrl || defaultAnthropicUrl);
    } else {
      setBulkAnthropicBaseUrl("");
    }
    setError(null);
    const alreadyConfigured = providers.some(p => p.id.startsWith(`${template.id}-`));
    setStep(alreadyConfigured ? "configured" : "token");
  };
  const disconnectTemplate = async () => {
    if (!bulkTemplate) return;
    for (const p of providers) {
      if (p.id.startsWith(`${bulkTemplate.id}-`)) {
        await remove(p.id);
      }
    }
    setBulkTemplate(null);
    setBulkToken("");
    setBulkAnthropicBaseUrl("");
    setStep("pickTemplate");
  };
  const handleTestToken = async () => {
    if (!bulkTemplate || !bulkToken.trim()) {
      setError("Cole uma API key antes de testar");
      return;
    }
    setTesting(true);
    setTestResult(null);
    setError(null);
    const token = bulkToken.trim();
    const customRoute = normalizeBaseUrl(bulkAnthropicBaseUrl);
    if (bulkTemplate.id === "mimo" && (!customRoute || !isValidHttpBaseUrl(customRoute))) {
      setError("URL do cluster MIMO inválida");
      setTesting(false);
      return;
    }
    if (bulkTemplate.id === "9router" && (!customRoute || !isValidHttpBaseUrl(customRoute))) {
      setError("URL da instância 9Router inválida");
      setTesting(false);
      return;
    }
    try {
      let integrations = bulkTemplate.integrations;
      const results = [];
      for (const integ of integrations) {
        const baseUrl = resolveIntegrationBaseUrl(bulkTemplate, integ, customRoute);
        const res = await window.codeBrainApp?.providers?.testToken?.({
          type: integ.type,
          host: integ.host,
          baseUrl,
          token
        });
        results.push({
          ok: !!res?.ok,
          status: res?.status,
          reason: res?.reason,
          hint: res?.hint,
          route: baseUrl,
          integration: integ.host === "openclaude" ? "OpenClaude" : integ.host === "gemini" ? "Gemini" : integ.type === "mimo-compat" ? "MIMO" : "Custom"
        });
      }
      if (results.length === 0) {
        setTestResult({
          ok: false,
          hint: "Nenhuma integração disponível para testar."
        });
      } else {
        const failed = results.find(r => !r.ok);
        setTestResult({
          ok: !failed,
          status: failed?.status,
          reason: failed?.reason,
          hint: failed?.hint,
          route: failed?.route,
          integration: failed?.integration,
          results
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        hint: err instanceof Error ? err.message : String(err)
      });
    }
    setTesting(false);
  };
  const handleBulkSave = async () => {
    if (!bulkTemplate || !bulkToken.trim()) {
      setError("API key obrigatória");
      return;
    }
    setBulkSaving(true);
    setError(null);
    const token = bulkToken.trim();
    const customRoute = normalizeBaseUrl(bulkAnthropicBaseUrl);
    if (bulkTemplate.id === "mimo" && (!customRoute || !isValidHttpBaseUrl(customRoute))) {
      setError("URL do cluster MIMO inválida");
      setBulkSaving(false);
      return;
    }
    if (bulkTemplate.id === "9router" && (!customRoute || !isValidHttpBaseUrl(customRoute))) {
      setError("URL da instância 9Router inválida");
      setBulkSaving(false);
      return;
    }
    try {
      for (const p of providers) {
        if (p.id.startsWith(`${bulkTemplate.id}-`)) {
          await remove(p.id);
        }
      }
      const detected = await window.codeBrainApp.cli.detect().catch(() => ({}));
      const geminiFound = detected?.gemini?.found ?? false;
      const eligible = bulkTemplate.integrations.filter(i => {
        if (i.host === "gemini") return geminiFound;
        return true;
      });
      if (eligible.length === 0) {
        setError(`Nenhum CLI compatível instalado pra ${bulkTemplate.label}.`);
        setBulkSaving(false);
        return;
      }
      for (const integ of eligible) {
        const env = {};
        if (integ.type === "anthropic-compat" || integ.type === "mimo-compat") {
          env.ANTHROPIC_BASE_URL = resolveIntegrationBaseUrl(bulkTemplate, integ, customRoute);
          env[integ.tokenEnvVar] = token;
        } else if (integ.type === "gemini-compat") {
          env.GEMINI_BASE_URL = resolveIntegrationBaseUrl(bulkTemplate, integ, customRoute);
          env[integ.tokenEnvVar] = token;
        } else if (integ.type === "openai-compat") {
          env.OPENAI_BASE_URL = resolveIntegrationBaseUrl(bulkTemplate, integ, customRoute);
          env[integ.tokenEnvVar] = token;
        }
        // 9Router: models are dynamic (whatever the user configured in the instance
        // dashboard) — auto-detect from /v1/models so the pane menu is populated on save
        let models = [...integ.models];
        if (bulkTemplate.id === "9router" && models.length === 0 && env.ANTHROPIC_BASE_URL) {
          const fetched = await fetchModelsFromEndpoint(env.ANTHROPIC_BASE_URL, token, "anthropic").catch(() => []);
          if (fetched.length > 0) models = fetched;
        }
        const res = await save({
          id: `${bulkTemplate.id}-${nanoid(6)}`,
          label: integ.label ?? `${bulkTemplate.label} via ${integ.host}`,
          type: integ.type,
          host: integ.host,
          env,
          models
        });
        if (!res.ok) {
          setError(res.error ?? "falha ao salvar");
          setBulkSaving(false);
          return;
        }
      }
      setBulkSaving(false);
      setBulkTemplate(null);
      setBulkToken("");
      setBulkAnthropicBaseUrl(DEFAULT_MIMO_ANTHROPIC_BASE_URL);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBulkSaving(false);
    }
  };
  const handleSave = async () => {
    if (!editing) return;
    const original = providers.find(p => p.id === editing.id);
    const cleanEnv = {};
    for (const [k2, v2] of Object.entries(editing.env ?? {})) {
      if (typeof v2 !== "string") continue;
      if (/_(API_KEY|AUTH_TOKEN)$/.test(k2) && /^\*+$/.test(v2)) {
        const orig = original?.env?.[k2];
        if (orig) cleanEnv[k2] = orig;
        continue;
      }
      cleanEnv[k2] = v2;
    }
    let cleanModels = (editing.models ?? []).map(m => m.trim()).filter(Boolean);
    const baseUrl = cleanEnv.ANTHROPIC_BASE_URL ?? cleanEnv.GEMINI_BASE_URL ?? cleanEnv.OPENAI_BASE_URL;
    const tokenKey = editing.type === "anthropic-compat" || editing.type === "mimo-compat" ? "ANTHROPIC_AUTH_TOKEN" : editing.type === "gemini-compat" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
    const token = cleanEnv[tokenKey];
    // Only auto-fetch models for NEW providers (no original). For existing providers,
    // respect the user's explicit edits (removals/changes) and never override them.
    if (!original && baseUrl && token && cleanModels.length === 0) {
      const fetched = await fetchModelsFromEndpoint(baseUrl, token, editing.type === "anthropic-compat" || editing.type === "mimo-compat" ? "anthropic" : editing.type === "gemini-compat" ? "gemini" : "openai");
      if (fetched.length > 0) cleanModels = fetched;
    }

    // Special case: mimo-claude is a virtual provider that inherits its key from the
    // real MIMO (mimo-compat) provider. Saving a key here should update the MIMO provider
    // directly so provider-resolver.ts can find it in the store on next spawn.
    if (editing.id === "mimo-claude") {
      const newKey = cleanEnv["ANTHROPIC_AUTH_TOKEN"] || cleanEnv["MIMO_API_KEY"];
      if (newKey) {
        const mimoProvider = providers.find(p =>
          p.type === "mimo-compat" ||
          (p.id || "").toLowerCase().includes("mimo") ||
          (p.label || "").toLowerCase().includes("mimo")
        );
        if (mimoProvider) {
          const updated = {
            ...mimoProvider,
            env: {
              ...(mimoProvider.env ?? {}),
              ANTHROPIC_AUTH_TOKEN: newKey,
            },
          };
          const res = await save(updated);
          if (!res.ok) { setError(res.error ?? "falha ao salvar key no provider MIMO"); return; }
          setEditing(null);
          setError(null);
          onClose();
          return;
        }
      }
      // No real MIMO provider found — nothing to update, close silently
      setEditing(null);
      setError(null);
      onClose();
      return;
    }

    const payload = {
      ...editing,
      env: cleanEnv,
      models: cleanModels
    };
    const res = await save(payload);
    if (!res.ok) {
      setError(res.error ?? "unknown error");
      return;
    }
    setEditing(null);
    setError(null);
    onClose();
  };
  const cancel = () => {
    setEditing(null);
    setError(null);
    if (step === "token") {
      setBulkTemplate(null);
      setBulkToken("");
      setBulkAnthropicBaseUrl(DEFAULT_MIMO_ANTHROPIC_BASE_URL);
      setStep("pickTemplate");
      return;
    }
    if (initialProvider) {
      onClose();
    } else {
      setStep("list");
    }
  };
  return <div className="fixed top-[38px] left-0 right-0 bottom-0 z-[10001] flex items-center justify-center bg-black/70 backdrop-blur-sm cursor-pointer" onClick={onClose}>
      <div className="bg-black border border-white/10 rounded-xl shadow-2xl w-[640px] max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            {step !== "list" && <button onClick={cancel} className="text-gray-600 hover:text-white">
                <ChevronLeft size={14} strokeWidth={1.5} />
              </button>}
            <KeyRound size={14} strokeWidth={1.5} className="text-indigo-500/70" />
            <h2 className="font-mono text-[12px] font-bold text-white tracking-wider">
              {step === "list" && "PROVIDERS"}
              {step === "pickTemplate" && "CHOOSE PROVIDER"}
              {step === "token" && (bulkTemplate ? `${bulkTemplate.label.toUpperCase()} — API KEY` : "API KEY")}
              {step === "form" && (editing && providers.some(p => p.id === editing.id) ? "EDIT PROVIDER" : "NEW PROVIDER")}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-red-500 cursor-pointer">
            <X$1 size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {step === "list" && <ProviderList providers={providers} onAdd={() => setStep("pickTemplate")} onEdit={startEdit} onDelete={remove} />}
          {step === "pickTemplate" && <TemplatePicker templates={templates} onPick={pickTemplate} onPickDirect={pickTemplateDirect} existingProviders={providers} />}
          {step === "token" && bulkTemplate && <BulkTokenForm template={bulkTemplate} token={bulkToken} onTokenChange={v2 => {
          setBulkToken(v2);
          setError(null);
          setTestResult(null);
        }} mimoAnthropicBaseUrl={bulkAnthropicBaseUrl} onMimoAnthropicBaseUrlChange={v2 => {
          setBulkAnthropicBaseUrl(v2);
          setError(null);
          setTestResult(null);
        }} onSave={handleBulkSave} onCancel={() => {
          setStep("pickTemplate");
          setBulkTemplate(null);
          setBulkToken("");
          setBulkAnthropicBaseUrl(DEFAULT_MIMO_ANTHROPIC_BASE_URL);
          setError(null);
          setTestResult(null);
        }} onTest={handleTestToken} testing={testing} testResult={testResult} saving={bulkSaving} error={error} />}
          {step === "configured" && bulkTemplate && <ConfiguredTemplateView template={bulkTemplate} providers={providers.filter(p => p.id.startsWith(`${bulkTemplate.id}-`))} onEdit={() => {
          setBulkToken("");
          setStep("token");
        }} onDisconnect={disconnectTemplate} onBack={() => {
          setBulkTemplate(null);
          setStep("pickTemplate");
        }} />}
          {step === "form" && editing && <ProviderForm provider={editing} onChange={setEditing} onCancel={cancel} onSave={handleSave} error={error} simple={initialStep === "pickTemplate"} signupUrl={templates.find(t => editing.id.startsWith(`${t.id}-`))?.signupUrl} />}
        </div>
      </div>
    </div>;
}