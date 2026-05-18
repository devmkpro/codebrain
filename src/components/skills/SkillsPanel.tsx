import { useEffect, useState, useCallback } from "react";
import { useSkillsStore, type SkillEntry } from "../../stores/skills-store";
import type { SkillManifest } from "../../types/electron";

// ── Icons (inline to avoid extra imports) ──
const Zap = ({ size = 12, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
);
const Download = ({ size = 12, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
);
const Trash2 = ({ size = 12, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);
const RefreshCw = ({ size = 12, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
);
const Search = ({ size = 12, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
);
const Package = ({ size = 12, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><line x1="16.5" y1="9.4" x2="7.5" y2="4.21" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
);
const X = ({ size = 12, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);

// ── Skill Card ──

function SkillCard({ entry, onView, onUninstall }: {
  entry: SkillEntry;
  onView: () => void;
  onUninstall: () => void;
}) {
  const m = entry.manifest;
  return (
    <div
      onClick={onView}
      className="group p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-indigo-500/30 transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Package size={13} className="text-indigo-400 shrink-0" />
          <span className="text-[11px] font-semibold text-slate-200 truncate">{m.name}</span>
        </div>
        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
          m.type === "squad"
            ? "bg-violet-500/15 text-violet-300 border border-violet-500/20"
            : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20"
        }`}>{m.type}</span>
      </div>
      <p className="text-[10px] text-slate-500 line-clamp-2 mb-2">{m.description}</p>
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(m.tags || []).slice(0, 3).map(tag => (
            <span key={tag} className="px-1.5 py-0.5 rounded bg-white/5 text-[8px] font-mono text-slate-500">{tag}</span>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] font-mono text-slate-600">v{m.version}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onUninstall(); }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/15 text-slate-600 hover:text-red-400 transition-all"
            title="Uninstall"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Skill Detail Modal ──

function SkillDetailModal({ manifest, content, onClose, onUninstall }: {
  manifest: SkillManifest;
  content?: Record<string, string>;
  onClose: () => void;
  onUninstall: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[520px] max-h-[80vh] rounded-2xl border border-white/10 bg-[#0c0c14] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3 min-w-0">
            <Package size={16} className="text-indigo-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">{manifest.name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                  manifest.type === "squad"
                    ? "bg-violet-500/15 text-violet-300 border border-violet-500/20"
                    : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20"
                }`}>{manifest.type}</span>
                <span className="text-[9px] font-mono text-slate-500">v{manifest.version}</span>
                {manifest.author && <span className="text-[9px] text-slate-600">by {manifest.author}</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-[11px] text-slate-400 leading-relaxed">{manifest.description}</p>

          {manifest.tags && manifest.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {manifest.tags.map(tag => (
                <span key={tag} className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/15 text-[9px] font-mono text-indigo-300">{tag}</span>
              ))}
            </div>
          )}

          {manifest.tools && manifest.tools.length > 0 && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">MCP Tools Used</p>
              <div className="flex flex-wrap gap-1.5">
                {manifest.tools.map(tool => (
                  <span key={tool} className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/15 text-[9px] font-mono text-emerald-300">{tool}</span>
                ))}
              </div>
            </div>
          )}

          {content && Object.entries(content).map(([filename, fileContent]) => (
            <div key={filename}>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-mono">{filename}</p>
              <pre className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[10px] text-slate-300 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                {fileContent}
              </pre>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-3 border-t border-white/[0.06]">
          <button
            onClick={() => { onUninstall(); onClose(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/20 text-red-400 text-[10px] font-bold uppercase tracking-wider hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={10} /> Uninstall
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Panel ──

export default function SkillsPanel() {
  const { installed, registrySkills, loading, syncing, error, loadInstalled, loadRegistry, installFromRegistry, uninstallSkill, sync, getSkill } = useSkillsStore();
  const [filter, setFilter] = useState<"all" | "prompt" | "squad">("all");
  const [selectedSkill, setSelectedSkill] = useState<{ manifest: SkillManifest; content?: Record<string, string> } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    loadInstalled();
    loadRegistry();
  }, []);

  const handleView = useCallback(async (id: string) => {
    const result = await getSkill(id);
    if (result.ok) {
      setSelectedSkill({ manifest: result.manifest!, content: result.content });
    }
  }, [getSkill]);

  const handleInstall = useCallback(async (id: string) => {
    const result = await installFromRegistry(id);
    setStatusMsg(result.ok ? `Installed ${id}` : result.error || "Install failed");
    setTimeout(() => setStatusMsg(null), 3000);
  }, [installFromRegistry]);

  const handleUninstall = useCallback(async (id: string) => {
    const result = await uninstallSkill(id);
    setStatusMsg(result.ok ? `Uninstalled ${id}` : result.error || "Uninstall failed");
    setTimeout(() => setStatusMsg(null), 3000);
    if (selectedSkill?.manifest.id === id) setSelectedSkill(null);
  }, [uninstallSkill, selectedSkill]);

  const handleSync = useCallback(async () => {
    const result = await sync("pull");
    if (result.ok && result.results) {
      setStatusMsg(`Synced: ${result.results.length} skill(s) updated`);
    } else {
      setStatusMsg(result.error || "Sync failed");
    }
    setTimeout(() => setStatusMsg(null), 3000);
  }, [sync]);

  const filteredInstalled = installed.filter(e =>
    (filter === "all" || e.manifest.type === filter) &&
    (!searchQuery || e.manifest.name.toLowerCase().includes(searchQuery.toLowerCase()) || e.manifest.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const installedIds = new Set(installed.map(e => e.manifest.id));
  const filteredRegistry = registrySkills.filter(s =>
    !installedIds.has(s.id) &&
    (filter === "all" || s.type === filter) &&
    (!searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Package size={13} className="text-indigo-400" />
          <span className="text-[11px] font-bold text-white tracking-wide">Skills</span>
          <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-[8px] font-mono text-indigo-300">{installed.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => loadInstalled()}
            disabled={loading}
            className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-white transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-indigo-500/20 text-indigo-300 text-[9px] font-bold uppercase tracking-wider hover:bg-indigo-500/10 transition-colors disabled:opacity-40"
          >
            <Download size={10} className={syncing ? "animate-bounce" : ""} />
            Sync
          </button>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="px-3 py-2 space-y-2 border-b border-white/[0.06]">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            type="text"
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[10px] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/30 transition-colors"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "prompt", "squad"] as const).map(t => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-colors ${
                filter === t
                  ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/20"
                  : "text-slate-600 hover:text-slate-400 border border-transparent"
              }`}
            >
              {t === "all" ? "All" : t}
            </button>
          ))}
        </div>
      </div>

      {/* Status message */}
      {statusMsg && (
        <div className="mx-3 mt-2 px-2.5 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-[10px] text-indigo-300">
          {statusMsg}
        </div>
      )}
      {error && (
        <div className="mx-3 mt-2 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-[10px] text-red-300">
          {error}
        </div>
      )}

      {/* Skills list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Installed */}
        {filteredInstalled.length > 0 && (
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-2">Installed</p>
            <div className="grid gap-2">
              {filteredInstalled.map(entry => (
                <SkillCard
                  key={entry.manifest.id}
                  entry={entry}
                  onView={() => handleView(entry.manifest.id)}
                  onUninstall={() => handleUninstall(entry.manifest.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Available from registry */}
        {filteredRegistry.length > 0 && (
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-2">Available from Registry</p>
            <div className="grid gap-2">
              {filteredRegistry.map(skill => (
                <div
                  key={skill.id}
                  className="group p-3 rounded-xl border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.03] hover:border-indigo-500/20 transition-all"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Zap size={12} className="text-slate-500 shrink-0" />
                      <span className="text-[11px] font-medium text-slate-300 truncate">{skill.name}</span>
                    </div>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                      skill.type === "squad"
                        ? "bg-violet-500/10 text-violet-400/60 border border-violet-500/10"
                        : "bg-emerald-500/10 text-emerald-400/60 border border-emerald-500/10"
                    }`}>{skill.type}</span>
                  </div>
                  <p className="text-[10px] text-slate-600 mb-2">{skill.description}</p>
                  <button
                    onClick={() => handleInstall(skill.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-indigo-500/20 text-indigo-400 text-[9px] font-bold uppercase tracking-wider hover:bg-indigo-500/10 transition-colors"
                  >
                    <Download size={10} /> Install
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {filteredInstalled.length === 0 && filteredRegistry.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Package size={24} className="text-slate-700 mb-3" />
            <p className="text-[11px] text-slate-500 mb-1">No skills found</p>
            <p className="text-[10px] text-slate-600">Sync to pull skills from the registry</p>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedSkill && (
        <SkillDetailModal
          manifest={selectedSkill.manifest}
          content={selectedSkill.content}
          onClose={() => setSelectedSkill(null)}
          onUninstall={() => handleUninstall(selectedSkill.manifest.id)}
        />
      )}
    </div>
  );
}
