import { useCronStore } from '../../stores/cron-store';

/**
 * CronPanel — sidebar panel for scheduled jobs.
 * Backend: cron_create/list/delete/update MCP tools (already ported).
 */
export function CronPanel() {
  const visible = useCronStore(s => s.visible);
  const jobs = useCronStore(s => s.jobs);
  const loading = useCronStore(s => s.loading);
  const toggle = useCronStore(s => s.toggle);
  const load = useCronStore(s => s.load);

  if (!visible) return null;

  return (
    <div className="absolute right-0 top-0 bottom-0 z-20 w-72 bg-[#0d0d12] border-l border-white/[0.06] flex flex-col shadow-2xl overflow-hidden" style={{ WebkitAppRegion: "no-drag" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          <span className="text-[12px] font-semibold text-slate-200">Scheduled Jobs</span>
          {jobs.length > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-[8px] font-bold text-indigo-300">
              {jobs.length}
            </span>
          )}
        </div>
        <button onClick={toggle} className="text-slate-600 hover:text-slate-300 transition-colors p-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && (
          <div className="text-center py-4 text-[10px] text-slate-500">Loading...</div>
        )}

        {!loading && jobs.length === 0 && (
          <div className="text-center py-8">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-slate-600 mb-3">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            <div className="text-[11px] text-slate-400 mb-1">No scheduled jobs</div>
            <div className="text-[9px] text-slate-600">
              Use <code className="text-indigo-400">cron_create</code> to schedule autonomous tasks
            </div>
          </div>
        )}

        {jobs.map((job: any, i: number) => (
          <div key={job.id || i} className="p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-all">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-slate-300 truncate">{job.name || job.id || `Job ${i + 1}`}</span>
              <span className={`px-1.5 py-0.5 rounded text-[7px] font-bold uppercase ${
                job.status === 'active' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 'bg-slate-500/15 text-slate-400 border border-slate-500/20'
              }`}>
                {job.status}
              </span>
            </div>
            {job.schedule && (
              <div className="text-[9px] text-slate-500 font-mono">{job.schedule}</div>
            )}
            {job.description && (
              <div className="text-[9px] text-slate-600 truncate mt-1">{job.description}</div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-white/[0.06]">
        <button
          onClick={() => load()}
          className="w-full py-1.5 rounded-lg text-[9px] font-medium bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-slate-200 transition-colors"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
