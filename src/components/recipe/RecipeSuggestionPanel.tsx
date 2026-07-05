import { useEffect, useState, useCallback } from "react";
import { useRecipeStore, type Recipe, type CatalogItem, type RecipeStep } from "../../stores/recipe-store";

// ── Inline Icons ───────────────────────────────────────────────────────────
const ChefHat = ({ size = 14, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z" />
    <line x1="6" y1="17" x2="18" y2="17" />
  </svg>
);
const Sparkles = ({ size = 14, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
  </svg>
);
const BookOpen = ({ size = 14, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);
const Save = ({ size = 14, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
  </svg>
);
const Trash2 = ({ size = 14, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
const RefreshCw = ({ size = 14, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);
const ChevronDown = ({ size = 14, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const Package = ({ size = 14, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
  </svg>
);
const X = ({ size = 14, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// ── Role Badge ─────────────────────────────────────────────────────────────
const ROLE_COLORS: Record<string, string> = {
  orchestrator: "bg-violet-500/15 text-violet-300 border-violet-500/20",
  backend: "bg-blue-500/15 text-blue-300 border-blue-500/20",
  frontend: "bg-pink-500/15 text-pink-300 border-pink-500/20",
  tester: "bg-amber-500/15 text-amber-300 border-amber-500/20",
  browser: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
  general: "bg-slate-500/15 text-slate-300 border-slate-500/20",
};

function RoleBadge({ role }: { role: string }) {
  const cls = ROLE_COLORS[role] || ROLE_COLORS.general;
  return (
    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border ${cls}`}>
      {role}
    </span>
  );
}

// ── Recipe Step Card ───────────────────────────────────────────────────────
function StepCard({ step, index }: { step: RecipeStep; index: number }) {
  return (
    <div className={`flex items-start gap-2 p-2 rounded-lg border text-[10px] ${
      step.gap
        ? "border-red-500/20 bg-red-500/[0.03]"
        : "border-white/[0.06] bg-white/[0.02]"
    }`}>
      <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[9px] font-bold">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-1">
          <RoleBadge role={step.role} />
          {step.parallel && (
            <span className="px-1 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/20 text-[7px] font-bold">
              ∥ parallel
            </span>
          )}
        </div>
        <div className="text-slate-300 font-medium truncate">{step.skill}</div>
        <div className="text-slate-500 truncate">
          agent: {step.agent} {step.model ? `· ${step.model}` : ""}
        </div>
        {step.produces && (
          <div className="text-emerald-400/70 truncate mt-0.5">→ {step.produces}</div>
        )}
        {step.gap && (
          <div className="text-red-400/80 truncate mt-0.5">⚠ {step.gap}</div>
        )}
      </div>
    </div>
  );
}

// ── Recipe Card ────────────────────────────────────────────────────────────
function RecipeCard({ recipe, onSave, onDelete, isSaved }: {
  recipe: Recipe;
  onSave?: () => void;
  onDelete?: () => void;
  isSaved?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-indigo-500/30 transition-all">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ChefHat size={13} className="text-indigo-400 shrink-0" />
            <span className="text-[11px] font-semibold text-slate-200 truncate">{recipe.name}</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">{recipe.deliverable}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {recipe.favoriteModel && (
            <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 text-[8px] font-bold truncate max-w-[100px]">
              {recipe.favoriteModel}
            </span>
          )}
          {onSave && !isSaved && (
            <button onClick={(e) => { e.stopPropagation(); onSave(); }}
              className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400/60 hover:text-emerald-300 transition-colors"
              title="Save recipe">
              <Save size={12} />
            </button>
          )}
          {onDelete && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded hover:bg-red-500/20 text-red-400/60 hover:text-red-300 transition-colors"
              title="Delete recipe">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Steps summary */}
      <div className="flex items-center gap-2 text-[9px] text-slate-500 mb-2">
        <span>{recipe.steps.length} steps</span>
        <span>·</span>
        <span>{recipe.steps.filter(s => s.role === "backend").length} backend</span>
        <span>·</span>
        <span>{recipe.steps.filter(s => s.role === "frontend").length} frontend</span>
        {recipe.steps.some(s => s.gap) && (
          <>
            <span>·</span>
            <span className="text-red-400/80">has gaps</span>
          </>
        )}
      </div>

      {/* Questions */}
      {recipe.questions.length > 0 && !expanded && (
        <div className="text-[9px] text-amber-400/60 truncate">
          ❓ {recipe.questions[0]}
        </div>
      )}

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 mt-2 text-[9px] text-slate-500 hover:text-slate-300 transition-colors"
      >
        <ChevronDown size={10} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
        {expanded ? "Collapse" : "View steps"}
      </button>

      {/* Expanded steps */}
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {/* Questions */}
          {recipe.questions.length > 0 && (
            <div className="p-2 rounded-lg border border-amber-500/10 bg-amber-500/[0.03]">
              <div className="text-[9px] font-semibold text-amber-300 mb-1">Scope Questions:</div>
              {recipe.questions.map((q, i) => (
                <div key={i} className="text-[10px] text-amber-200/60">• {q}</div>
              ))}
            </div>
          )}
          {/* Steps */}
          {recipe.steps.map((step, i) => (
            <StepCard key={i} step={step} index={i} />
          ))}
          {/* Delivery */}
          {recipe.delivery && (
            <div className="p-2 rounded-lg border border-emerald-500/10 bg-emerald-500/[0.03]">
              <div className="text-[9px] font-semibold text-emerald-300 mb-0.5">Delivery:</div>
              <div className="text-[10px] text-emerald-200/60">{recipe.delivery}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Catalog Item ───────────────────────────────────────────────────────────
function CatalogItemCard({ item }: { item: CatalogItem }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg border border-white/[0.04] bg-white/[0.01]">
      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[7px] font-bold uppercase tracking-wider ${
        item.kind === "agent"
          ? "bg-blue-500/15 text-blue-300 border border-blue-500/20"
          : "bg-purple-500/15 text-purple-300 border border-purple-500/20"
      }`}>
        {item.kind}
      </span>
      <RoleBadge role={item.role} />
      <span className="text-[10px] text-slate-300 font-medium truncate">{item.name}</span>
      {item.blurb && (
        <span className="text-[9px] text-slate-500 truncate ml-auto">{item.blurb}</span>
      )}
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────

type Tab = "recipes" | "catalog" | "saved";

export default function RecipeSuggestionPanel() {
  const visible = useRecipeStore(s => s.visible);
  const toggle = useRecipeStore(s => s.toggle);
  const [tab, setTab] = useState<Tab>("recipes");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const {
    catalog,
    catalogUpdatedAt,
    proposedRecipes,
    savedRecipes,
    ingredients,
    loading,
    error,
    lastAction,
    enrichCatalog,
    proposeRecipes,
    loadCatalog,
    loadSavedRecipes,
    loadIngredients,
    saveRecipe,
    deleteRecipe,
    clearError,
  } = useRecipeStore();

  // Load on mount
  useEffect(() => {
    loadCatalog();
    loadSavedRecipes();
    loadIngredients();
  }, [loadCatalog, loadSavedRecipes, loadIngredients]);

  const handlePropose = useCallback(async () => {
    await proposeRecipes();
  }, [proposeRecipes]);

  const handleEnrich = useCallback(async () => {
    await enrichCatalog(true);
  }, [enrichCatalog]);

  const savedNames = new Set(savedRecipes.map(r => r.name));
  const filteredCatalog = roleFilter === "all"
    ? catalog
    : catalog.filter(c => c.role === roleFilter);

  const catalogAge = catalogUpdatedAt
    ? Math.floor((Date.now() - new Date(catalogUpdatedAt).getTime()) / (1000 * 60 * 60))
    : null;

  if (!visible) return null;

  return (
    <div className="absolute right-0 top-0 bottom-0 z-20 w-72 bg-[#0d0d12] border-l border-white/[0.06] flex flex-col shadow-2xl overflow-hidden" style={{ WebkitAppRegion: "no-drag" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <ChefHat size={16} className="text-indigo-400" />
          <span className="text-[12px] font-semibold">Recipes</span>
          <span className="text-[9px] text-slate-500">· what can I build?</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleEnrich}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-medium bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40"
            title="Enrich catalog with LLM"
          >
            <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
            Enrich
          </button>
          <button
            onClick={handlePropose}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-medium bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 transition-colors disabled:opacity-40"
          >
            <Sparkles size={10} />
            Propose
          </button>
        </div>
      </div>

      {/* Status bar */}
      {(loading || lastAction) && (
        <div className="px-3 py-1.5 border-b border-white/[0.04] bg-white/[0.01]">
          {loading ? (
            <div className="flex items-center gap-2 text-[9px] text-indigo-300">
              <RefreshCw size={10} className="animate-spin" />
              {lastAction || "Processing..."}
            </div>
          ) : lastAction ? (
            <div className="text-[9px] text-slate-500">{lastAction}</div>
          ) : null}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-3 py-1.5 border-b border-red-500/20 bg-red-500/[0.05] flex items-center justify-between">
          <span className="text-[9px] text-red-300 truncate">{error}</span>
          <button onClick={clearError} className="text-red-400/60 hover:text-red-300">
            <X size={10} />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-white/[0.06]">
        {([["recipes", "Proposed"], ["catalog", "Catalog"], ["saved", "Saved"]] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-1.5 text-[10px] font-medium transition-colors ${
              tab === key
                ? "text-indigo-300 border-b-2 border-indigo-500 bg-indigo-500/[0.04]"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {label}
            {key === "recipes" && proposedRecipes.length > 0 && (
              <span className="ml-1 px-1 rounded bg-indigo-500/20 text-[8px]">{proposedRecipes.length}</span>
            )}
            {key === "saved" && savedRecipes.length > 0 && (
              <span className="ml-1 px-1 rounded bg-emerald-500/20 text-[8px]">{savedRecipes.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* ── Recipes Tab ── */}
        {tab === "recipes" && (
          <>
            {proposedRecipes.length === 0 && !loading && (
              <div className="text-center py-8">
                <ChefHat size={32} className="mx-auto text-slate-600 mb-3" />
                <div className="text-[11px] text-slate-400 mb-1">No recipes proposed yet</div>
                <div className="text-[9px] text-slate-600 mb-4">
                  Click <strong>Propose</strong> to discover what you can build with your current agents and skills
                </div>
                {/* Ingredients summary */}
                {ingredients && (
                  <div className="inline-flex flex-col gap-1 text-left">
                    <div className="text-[9px] text-slate-500">
                      📦 {ingredients.agents.length} agents · {ingredients.skills.length} skills · {ingredients.llms.length} LLMs
                    </div>
                  </div>
                )}
              </div>
            )}
            {proposedRecipes.map((recipe, i) => (
              <RecipeCard
                key={i}
                recipe={recipe}
                onSave={() => saveRecipe(recipe)}
                isSaved={savedNames.has(recipe.name)}
              />
            ))}
          </>
        )}

        {/* ── Catalog Tab ── */}
        {tab === "catalog" && (
          <>
            {catalog.length > 0 && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[9px] text-slate-500">
                  {catalog.length} items
                  {catalogAge !== null && ` · ${catalogAge}h old`}
                </span>
                {/* Role filter */}
                <div className="flex gap-1 ml-auto">
                  {["all", ...Object.keys(ROLE_COLORS)].map(role => (
                    <button
                      key={role}
                      onClick={() => setRoleFilter(role)}
                      className={`px-1.5 py-0.5 rounded text-[7px] font-bold uppercase tracking-wider transition-colors ${
                        roleFilter === role
                          ? "bg-indigo-500/20 text-indigo-300"
                          : "text-slate-600 hover:text-slate-400"
                      }`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {catalog.length === 0 && !loading && (
              <div className="text-center py-8">
                <Package size={32} className="mx-auto text-slate-600 mb-3" />
                <div className="text-[11px] text-slate-400 mb-1">Catalog not enriched yet</div>
                <div className="text-[9px] text-slate-600">
                  Click <strong>Enrich</strong> to classify your agents and skills
                </div>
              </div>
            )}
            {filteredCatalog.map((item, i) => (
              <CatalogItemCard key={i} item={item} />
            ))}
          </>
        )}

        {/* ── Saved Tab ── */}
        {tab === "saved" && (
          <>
            {savedRecipes.length === 0 && (
              <div className="text-center py-8">
                <BookOpen size={32} className="mx-auto text-slate-600 mb-3" />
                <div className="text-[11px] text-slate-400 mb-1">No saved recipes</div>
                <div className="text-[9px] text-slate-600">
                  Propose recipes and save the ones you like
                </div>
              </div>
            )}
            {savedRecipes.map((recipe, i) => (
              <RecipeCard
                key={i}
                recipe={recipe}
                onDelete={() => deleteRecipe(recipe.name)}
                isSaved
              />
            ))}
          </>
        )}
      </div>

      {/* Ingredients footer */}
      {ingredients && tab !== "catalog" && (
        <div className="px-3 py-1.5 border-t border-white/[0.06] bg-white/[0.01]">
          <div className="flex items-center gap-3 text-[8px] text-slate-600">
            <span>🤖 {ingredients.agents.join(", ")}</span>
            <span>📦 {ingredients.skills.length} skills</span>
            <span>🧠 {ingredients.llms.length} models</span>
          </div>
        </div>
      )}
    </div>
  );
}
