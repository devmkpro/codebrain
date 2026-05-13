import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  Terminal, RefreshCw, Trash2, Filter,
  AlertTriangle, Info, X, ChevronDown,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
  data?: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function levelColor(level: string) {
  switch (level?.toLowerCase()) {
    case 'error':   return { text: 'text-red-400',     bg: 'bg-red-500/5',     border: 'border-red-500/15',    dot: 'bg-red-500'    };
    case 'warn':    return { text: 'text-yellow-400',  bg: 'bg-yellow-500/5',  border: 'border-yellow-500/15', dot: 'bg-yellow-500' };
    case 'info':    return { text: 'text-cyan-400',    bg: 'bg-cyan-500/5',    border: 'border-cyan-500/15',   dot: 'bg-cyan-500'   };
    case 'debug':   return { text: 'text-slate-500',   bg: 'bg-transparent',   border: 'border-white/[0.03]',  dot: 'bg-slate-700'  };
    default:        return { text: 'text-slate-300',   bg: 'bg-transparent',   border: 'border-white/[0.03]',  dot: 'bg-slate-500'  };
  }
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts ?? '';
  }
}

function formatData(data: unknown): string | null {
  if (data === undefined || data === null) return null;
  try { return JSON.stringify(data, null, 2); } catch { return String(data); }
}

// ─── Log Row ─────────────────────────────────────────────────────────────────
function LogRow({ entry, isNew }: { entry: LogEntry & { _key: string }; isNew: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { text, bg, border, dot } = levelColor(entry.level);
  const hasData = entry.data !== undefined && entry.data !== null;
  const dataStr = hasData ? formatData(entry.data) : null;

  return (
    <motion.div
      initial={isNew ? { opacity: 0, x: -4, backgroundColor: 'rgba(79,70,229,0.08)' } : false}
      animate={{ opacity: 1, x: 0, backgroundColor: 'transparent' }}
      transition={{ duration: 0.4 }}
      className={`border-b ${border} ${bg} font-mono`}
    >
      <div
        className={`flex items-start gap-3 px-4 py-2 ${hasData ? 'cursor-pointer hover:bg-white/[0.02]' : ''}`}
        onClick={() => hasData && setExpanded(v => !v)}
      >
        {/* Level dot + time */}
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
          <span className="text-[9px] text-slate-700 w-16 shrink-0">{formatTime(entry.timestamp)}</span>
        </div>

        {/* Level badge */}
        <span className={`text-[8px] font-bold uppercase tracking-widest w-9 shrink-0 mt-0.5 ${text}`}>
          {(entry.level ?? 'log').slice(0, 5)}
        </span>

        {/* Message */}
        <p className={`text-[10px] flex-1 leading-relaxed break-all ${text}`}>
          {entry.message}
        </p>

        {/* Expand arrow */}
        {hasData && (
          <ChevronDown size={11} className={`text-slate-700 shrink-0 mt-0.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        )}
      </div>

      {/* Data expanded */}
      {expanded && dataStr && (
        <div className="px-4 pb-2 pl-[4.5rem]">
          <pre className="text-[9px] text-slate-500 bg-black/30 rounded p-2 overflow-x-auto max-h-40" style={{ scrollbarWidth: 'thin' }}>
            {dataStr}
          </pre>
        </div>
      )}
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
const ALL_LEVELS: LogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

export function LogsPage() {
  const [entries,    setEntries]   = useState<(LogEntry & { _key: string })[]>([]);
  const [loading,    setLoading]   = useState(true);
  const [filter,     setFilter]    = useState<LogLevel | 'all'>('all');
  const [search,     setSearch]    = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [newKeys,    setNewKeys]   = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  let keyCounter = useRef(0);

  const makeKey = () => `log-${Date.now()}-${++keyCounter.current}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list: LogEntry[] = await (window as any).codeBrainApp?.log?.list?.() ?? [];
      setEntries(list.map(e => ({ ...e, _key: makeKey() })));
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();

    // Live subscription
    const off = (window as any).codeBrainApp?.log?.onAppended?.((entry: LogEntry) => {
      const key = makeKey();
      setEntries(prev => [...prev.slice(-999), { ...entry, _key: key }]); // cap at 1000
      setNewKeys(prev => { const next = new Set(prev); next.add(key); setTimeout(() => setNewKeys(s => { const n = new Set(s); n.delete(key); return n; }), 1000); return next; });
    });
    return () => off?.();
  }, [load]);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, autoScroll]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  };

  const filtered = entries.filter(e => {
    if (filter !== 'all' && (e.level ?? 'log').toLowerCase() !== filter) return false;
    if (search && !e.message?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = entries.reduce<Record<string, number>>((acc, e) => {
    const l = (e.level ?? 'log').toLowerCase();
    acc[l] = (acc[l] ?? 0) + 1;
    return acc;
  }, {});

  const errorCount = counts['error'] ?? 0;
  const warnCount  = counts['warn']  ?? 0;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left sidebar — stats + filters */}
      <aside className="w-52 border-r border-white/5 bg-[#0F0F13] hidden md:flex flex-col overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        <div className="p-4 border-b border-white/5">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Filtros</h3>
          <div className="space-y-1">
            <button
              onClick={() => setFilter('all')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[10px] transition-all ${filter === 'all' ? 'bg-[#4F46E5]/10 border border-[#4F46E5]/20 text-indigo-300' : 'text-slate-500 hover:bg-white/5 border border-transparent hover:text-slate-300'}`}
            >
              <span>Todos</span>
              <span className="font-mono text-slate-600">{entries.length}</span>
            </button>
            {ALL_LEVELS.map(l => {
              const { text, dot } = levelColor(l);
              const count = counts[l] ?? 0;
              return (
                <button
                  key={l}
                  onClick={() => setFilter(l)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] transition-all ${filter === l ? 'bg-white/5 border border-white/10 ' + text : 'text-slate-500 hover:bg-white/5 border border-transparent hover:text-slate-300'}`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                  <span className="capitalize flex-1 text-left">{l}</span>
                  <span className="font-mono text-slate-700">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Summary boxes */}
        <div className="p-4 space-y-2">
          {errorCount > 0 && (
            <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2">
              <AlertTriangle size={12} className="text-red-400 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-red-400">{errorCount} erro{errorCount !== 1 ? 's' : ''}</p>
              </div>
            </div>
          )}
          {warnCount > 0 && (
            <div className="p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-2">
              <AlertTriangle size={12} className="text-yellow-400 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-yellow-400">{warnCount} aviso{warnCount !== 1 ? 's' : ''}</p>
              </div>
            </div>
          )}
          {errorCount === 0 && warnCount === 0 && entries.length > 0 && (
            <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2">
              <Info size={12} className="text-emerald-400 shrink-0" />
              <p className="text-[10px] font-bold text-emerald-400">Sem erros</p>
            </div>
          )}
        </div>

        <div className="p-4 mt-auto border-t border-white/5 space-y-2">
          <div className="flex items-center justify-between text-[9px] font-mono text-slate-700">
            <span>Auto-scroll</span>
            <button
              onClick={() => setAutoScroll(v => !v)}
              className={`w-8 h-4 rounded-full transition-colors ${autoScroll ? 'bg-[#4F46E5]' : 'bg-white/10'}`}
            >
              <span className={`block w-3 h-3 rounded-full bg-white transition-transform m-0.5 ${autoScroll ? 'translate-x-4' : ''}`} />
            </button>
          </div>
          <button
            onClick={() => { setEntries([]); setNewKeys(new Set()); }}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-white/10 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:border-red-500/20 hover:text-red-400 transition-all"
          >
            <Trash2 size={11} /> Limpar
          </button>
        </div>
      </aside>

      {/* Main log viewer */}
      <section className="flex-1 flex flex-col bg-[#0B0B0E] overflow-hidden">
        {/* Toolbar */}
        <div className="h-10 border-b border-white/5 flex items-center gap-3 px-4 bg-[#0F0F13]/50 shrink-0">
          <Terminal size={13} className="text-[#4F46E5] shrink-0" />
          <h1 className="text-[12px] font-bold text-white">Logs</h1>

          {/* Search */}
          <div className="flex-1 flex items-center gap-2 ml-2">
            <div className="relative flex-1 max-w-sm">
              <Filter size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filtrar mensagens…"
                className="w-full h-7 pl-7 pr-3 bg-white/5 border border-white/10 rounded text-[10px] font-mono text-slate-300 placeholder-slate-700 outline-none focus:border-[#4F46E5]/40 transition-colors"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                  <X size={10} />
                </button>
              )}
            </div>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[9px] font-mono text-slate-700">{filtered.length} entrada{filtered.length !== 1 ? 's' : ''}</span>
            <button
              onClick={load}
              disabled={loading}
              className="p-1.5 rounded text-slate-600 hover:text-slate-300 hover:bg-white/5 disabled:opacity-40 transition-all"
              title="Recarregar"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Log entries */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto"
          style={{ scrollbarWidth: 'thin' }}
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <RefreshCw size={20} className="text-slate-700 animate-spin" />
              <p className="text-[11px] text-slate-600 font-mono">Carregando logs…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Terminal size={32} className="text-slate-800" />
              <div className="text-center">
                <p className="text-[12px] font-bold text-slate-600">
                  {search || filter !== 'all' ? 'Nenhum log encontrado' : 'Nenhum log ainda'}
                </p>
                <p className="text-[10px] text-slate-700 mt-1">
                  {search || filter !== 'all' ? 'Tente outro filtro' : 'Logs do app aparecerão aqui em tempo real'}
                </p>
              </div>
            </div>
          ) : (
            <>
              {filtered.map(entry => (
                <LogRow
                  key={entry._key}
                  entry={entry}
                  isNew={newKeys.has(entry._key)}
                />
              ))}
              <div ref={bottomRef} className="h-4" />
            </>
          )}
        </div>

        {/* Live indicator */}
        <div className="h-7 border-t border-white/5 bg-[#0F0F13]/50 flex items-center px-4 gap-2 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[9px] font-mono text-slate-700 uppercase tracking-widest">Live · {entries.length} entradas</span>
          {!autoScroll && (
            <button
              onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
              className="ml-auto text-[9px] font-mono text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              ↓ ir ao fim
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
