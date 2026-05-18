import React from "react";
import {
  Database,
  X,
  Search,
  Brain,
  Tag,
  Trash2,
  Clock,
  BarChart3,
  Layers,
  Zap,
  BookOpen,
  Wrench,
  StickyNote,
} from "lucide-react";
import { useMemoryStore, type MemoryEntry, type PatternEntry } from "../../stores/memory-store";

const TYPE_ICONS: Record<string, typeof Database> = {
  episodic: Clock,
  semantic: BookOpen,
  procedural: Wrench,
  working: StickyNote,
};

const TYPE_COLORS: Record<string, string> = {
  episodic: "text-blue-400",
  semantic: "text-green-400",
  procedural: "text-orange-400",
  working: "text-gray-400",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts * 1000) / 1000);
  if (seconds < 60) return "agora";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function MemoryCard({ memory, onDelete }: { memory: MemoryEntry; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const Icon = TYPE_ICONS[memory.type] || Database;
  const color = TYPE_COLORS[memory.type] || "text-gray-400";

  return (
    <div className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
      <div
        className="flex items-start gap-2 px-3 py-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon size={12} strokeWidth={1.5} className={`${color} shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="font-mono text-[11px] text-white truncate">{memory.key}</p>
            <span className={`font-mono text-[8px] px-1 py-0.5 rounded bg-white/5 ${color}`}>
              {memory.type}
            </span>
          </div>
          {!expanded && (
            <p className="font-mono text-[10px] text-gray-600 truncate mt-0.5">
              {memory.content.slice(0, 80)}{memory.content.length > 80 ? "..." : ""}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className="font-mono text-[8px] text-gray-700">{timeAgo(memory.updated_at)}</span>
            {memory.agent_id && (
              <span className="font-mono text-[8px] text-gray-700">by {memory.agent_id.slice(0, 8)}</span>
            )}
            {memory.tags.length > 0 && (
              <div className="flex items-center gap-1">
                <Tag size={8} className="text-gray-700" />
                {memory.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="font-mono text-[8px] text-indigo-400/60">{tag}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(memory.id); }}
          className="text-gray-700 hover:text-red-500 cursor-pointer shrink-0"
        >
          <Trash2 size={10} strokeWidth={1.5} />
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-2 ml-5">
          <pre className="font-mono text-[10px] text-gray-400 whitespace-pre-wrap break-words bg-white/[0.02] rounded p-2 max-h-40 overflow-y-auto">
            {memory.content}
          </pre>
        </div>
      )}
    </div>
  );
}

function PatternCard({ pattern, onDelete }: { pattern: PatternEntry; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const qualityPct = Math.round(pattern.quality_score * 100);
  const qualityColor = qualityPct >= 70 ? "text-green-400" : qualityPct >= 40 ? "text-yellow-400" : "text-red-400";

  return (
    <div className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
      <div
        className="flex items-start gap-2 px-3 py-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <Zap size={12} strokeWidth={1.5} className="text-yellow-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[8px] px-1 py-0.5 rounded bg-yellow-400/10 text-yellow-400">
              {pattern.pattern_type}
            </span>
            <span className={`font-mono text-[9px] ${qualityColor}`}>
              {qualityPct}%
            </span>
            <span className="font-mono text-[8px] text-gray-700">
              {pattern.success_count}x used
            </span>
          </div>
          <p className="font-mono text-[10px] text-gray-400 mt-0.5 line-clamp-2">
            {pattern.description}
          </p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(pattern.id); }}
          className="text-gray-700 hover:text-red-500 cursor-pointer shrink-0"
        >
          <Trash2 size={10} strokeWidth={1.5} />
        </button>
      </div>
      {expanded && pattern.source_trajectory && (
        <div className="px-3 pb-2 ml-5">
          <p className="font-mono text-[9px] text-gray-600 mb-1">Source trajectory:</p>
          <pre className="font-mono text-[10px] text-gray-400 whitespace-pre-wrap break-words bg-white/[0.02] rounded p-2 max-h-32 overflow-y-auto">
            {pattern.source_trajectory}
          </pre>
        </div>
      )}
    </div>
  );
}

export function MemoryPanel() {
  const visible = useMemoryStore((s) => s.visible);
  const tab = useMemoryStore((s) => s.tab);
  const memories = useMemoryStore((s) => s.memories);
  const patterns = useMemoryStore((s) => s.patterns);
  const stats = useMemoryStore((s) => s.stats);
  const typeFilter = useMemoryStore((s) => s.typeFilter);
  const loading = useMemoryStore((s) => s.loading);
  const toggle = useMemoryStore((s) => s.toggle);
  const setTab = useMemoryStore((s) => s.setTab);
  const setTypeFilter = useMemoryStore((s) => s.setTypeFilter);
  const searchMemories = useMemoryStore((s) => s.searchMemories);
  const loadMemories = useMemoryStore((s) => s.loadMemories);
  const loadPatterns = useMemoryStore((s) => s.loadPatterns);
  const loadStats = useMemoryStore((s) => s.loadStats);
  const deleteMemory = useMemoryStore((s) => s.deleteMemory);
  const deletePattern = useMemoryStore((s) => s.deletePattern);

  const [searchInput, setSearchInput] = React.useState("");
  const searchTimer = React.useRef<ReturnType<typeof setTimeout>>();

  React.useEffect(() => {
    if (visible) {
      loadMemories();
      loadStats();
    }
  }, [visible, loadMemories, loadStats]);

  const handleSearch = React.useCallback(
    (value: string) => {
      setSearchInput(value);
      clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        searchMemories(value);
      }, 300);
    },
    [searchMemories]
  );

  if (!visible) return null;

  const types = ["", "episodic", "semantic", "procedural", "working"];

  return (
    <div
      className="absolute right-0 top-0 bottom-0 z-20 w-80 bg-black border-l border-white/10 flex flex-col shadow-2xl"
      style={{ WebkitAppRegion: "no-drag" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-1.5">
          <Database size={13} strokeWidth={1.5} className="text-indigo-500/70" />
          <p className="font-mono text-[10px] font-bold text-white tracking-widest uppercase">
            Memory
          </p>
          {stats && (
            <span className="font-mono text-[9px] text-gray-600">
              {stats.total} entries
            </span>
          )}
        </div>
        <button onClick={toggle} className="text-gray-600 hover:text-red-500 cursor-pointer">
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5 shrink-0">
        <button
          onClick={() => setTab("memories")}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 font-mono text-[10px] cursor-pointer transition-colors ${
            tab === "memories" ? "text-indigo-400 border-b border-indigo-400" : "text-gray-600 hover:text-gray-400"
          }`}
        >
          <Layers size={10} /> Memories
        </button>
        <button
          onClick={() => setTab("patterns")}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 font-mono text-[10px] cursor-pointer transition-colors ${
            tab === "patterns" ? "text-yellow-400 border-b border-yellow-400" : "text-gray-600 hover:text-gray-400"
          }`}
        >
          <Brain size={10} /> Patterns
        </button>
        <button
          onClick={() => { loadStats(); }}
          className="px-2 py-1.5 text-gray-600 hover:text-gray-400 cursor-pointer"
          title="Stats"
        >
          <BarChart3 size={10} />
        </button>
      </div>

      {/* Search + Filters (only for memories tab) */}
      {tab === "memories" && (
        <div className="px-3 py-2 border-b border-white/5 shrink-0 space-y-1.5">
          <div className="flex items-center gap-1.5 bg-white/[0.03] rounded px-2 py-1">
            <Search size={10} className="text-gray-600 shrink-0" />
            <input
              value={searchInput}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search memories..."
              className="flex-1 bg-transparent font-mono text-[10px] text-gray-300 outline-none placeholder-gray-700"
            />
            {searchInput && (
              <button
                onClick={() => handleSearch("")}
                className="text-gray-600 hover:text-gray-400 cursor-pointer"
              >
                <X size={10} />
              </button>
            )}
          </div>
          <div className="flex gap-1 flex-wrap">
            {types.map((t) => (
              <button
                key={t || "all"}
                onClick={() => setTypeFilter(t)}
                className={`font-mono text-[8px] px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                  typeFilter === t
                    ? "bg-indigo-500/20 text-indigo-400"
                    : "bg-white/5 text-gray-600 hover:text-gray-400"
                }`}
              >
                {t || "all"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stats Bar */}
      {tab === "memories" && stats && (
        <div className="px-3 py-1.5 border-b border-white/5 shrink-0 flex gap-3">
          {Object.entries(stats.byType).map(([type, info]) => (
            <div key={type} className="flex items-center gap-1">
              <span className={`font-mono text-[8px] ${TYPE_COLORS[type] || "text-gray-400"}`}>
                {type}
              </span>
              <span className="font-mono text-[8px] text-gray-700">{info.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-3 py-4 text-center">
            <p className="font-mono text-[10px] text-gray-600 animate-pulse">Loading...</p>
          </div>
        )}

        {tab === "memories" && !loading && memories.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="font-mono text-[10px] text-gray-700 leading-relaxed">
              Nenhuma memória ainda.
              <br />
              Agentes salvam via tool
              <br />
              <span className="text-gray-600">memory_write</span>.
            </p>
          </div>
        )}

        {tab === "memories" && !loading && memories.map((m) => (
          <MemoryCard key={m.id} memory={m} onDelete={deleteMemory} />
        ))}

        {tab === "patterns" && !loading && patterns.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="font-mono text-[10px] text-gray-700 leading-relaxed">
              Nenhum padrão aprendido.
              <br />
              Agentes salvam via tool
              <br />
              <span className="text-gray-600">pattern_write</span>.
            </p>
          </div>
        )}

        {tab === "patterns" && !loading && patterns.map((p) => (
          <PatternCard key={p.id} pattern={p} onDelete={deletePattern} />
        ))}
      </div>
    </div>
  );
}
