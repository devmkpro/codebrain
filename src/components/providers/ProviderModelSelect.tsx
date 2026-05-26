import React, { useState } from "react";

// ProviderModelSelect
export function ProviderModelSelect({
  providers,
  label,
  value,
  onChange
}) {
  const selectedProvider = providers.find(p => p.id === value.providerId) ?? providers[0];
  const models = selectedProvider?.models ?? [];
  // OpenRouter and providers with no models allow custom model ID input
  const allowCustomModel = selectedProvider?.id === "openrouter" || models.length === 0;
  const isCustomModel = allowCustomModel && value.model && !models.includes(value.model);
  const [customInput, setCustomInput] = useState(value.model ?? "");

  return <div className="space-y-1.5">
      <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">{label}</p>
      <div className="flex gap-2">
        <select value={selectedProvider?.id ?? ""} onChange={e => {
        const p = providers.find(pr => pr.id === e.target.value);
        const isCustom = p?.id === "openrouter" || (p?.models?.length ?? 0) === 0;
        onChange({
          providerId: p?.id,
          model: isCustom ? customInput || "" : p?.models?.[0]
        });
      }} className="flex-1 bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40 appearance-none">
          {providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {models.length > 0 && !isCustomModel && <select value={value.model ?? models[0] ?? ""} onChange={e => {
        const newModel = e.target.value;
        if (allowCustomModel && newModel === "__custom__") {
          setCustomInput("");
          onChange({ providerId: value.providerId ?? selectedProvider?.id, model: "" });
        } else {
          onChange({ providerId: value.providerId ?? selectedProvider?.id, model: newModel });
        }
      }} className="flex-1 bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40 appearance-none">
            {models.map(m => <option key={m} value={m}>{m}</option>)}
            {allowCustomModel && <option value="__custom__">Custom model...</option>}
          </select>}
        {(models.length === 0 || isCustomModel) && <input type="text" value={customInput} onChange={e => {
        setCustomInput(e.target.value);
        onChange({ providerId: value.providerId ?? selectedProvider?.id, model: e.target.value });
      }} placeholder="provider/model-name" spellCheck={false} className="flex-1 bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/40" />}
      </div>
    </div>;
}