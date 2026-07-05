import { create } from "zustand";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CatalogItem {
  name: string;
  kind: "agent" | "skill";
  role: string;
  blurb: string;
}

export interface RecipeStep {
  role: string;
  skill: string;
  agent: string;
  model: string;
  produces: string;
  parallel: boolean;
  gap?: string;
}

export interface Recipe {
  name: string;
  deliverable: string;
  favoriteModel: string;
  questions: string[];
  steps: RecipeStep[];
  delivery: string;
}

export interface Ingredients {
  agents: string[];
  skills: string[];
  llms: string[];
}

interface RecipeStore {
  // Sidebar state
  visible: boolean;
  toggle: () => void;

  // State
  catalog: CatalogItem[];
  catalogUpdatedAt: string | null;
  proposedRecipes: Recipe[];
  savedRecipes: Recipe[];
  ingredients: Ingredients | null;
  loading: boolean;
  error: string | null;
  lastAction: string | null;

  // Actions
  enrichCatalog: (force?: boolean) => Promise<void>;
  proposeRecipes: (model?: string) => Promise<void>;
  loadCatalog: () => Promise<void>;
  loadSavedRecipes: () => Promise<void>;
  loadIngredients: () => Promise<void>;
  saveRecipe: (recipe: Recipe) => Promise<boolean>;
  deleteRecipe: (name: string) => Promise<boolean>;
  clearError: () => void;
  clearProposed: () => void;
}

// ── Store ──────────────────────────────────────────────────────────────────

export const useRecipeStore = create<RecipeStore>((set, get) => ({
  visible: false,
  toggle: () => set((s) => ({ visible: !s.visible })),

  catalog: [],
  catalogUpdatedAt: null,
  proposedRecipes: [],
  savedRecipes: [],
  ingredients: null,
  loading: false,
  error: null,
  lastAction: null,

  enrichCatalog: async (force = false) => {
    set({ loading: true, error: null, lastAction: "Enriching catalog..." });
    try {
      const res = await window.codeBrainApp.recipe.enrichCatalog({ force });
      if (res?.ok) {
        set({
          catalog: res.data || [],
          loading: false,
          lastAction: res.cached
            ? "Catalog loaded from cache"
            : `Catalog enriched: ${(res.data || []).length} items`,
        });
      } else {
        set({ loading: false, error: res?.error || "Failed to enrich catalog" });
      }
    } catch (err: any) {
      set({ loading: false, error: err?.message || String(err) });
    }
  },

  proposeRecipes: async (model?: string) => {
    set({ loading: true, error: null, lastAction: "Proposing recipes..." });
    try {
      const res = await window.codeBrainApp.recipe.propose({ model });
      if (res?.ok) {
        set({
          proposedRecipes: res.data || [],
          loading: false,
          lastAction: `Proposed ${(res.data || []).length} recipes`,
        });
      } else {
        set({ loading: false, error: res?.error || "Failed to propose recipes" });
      }
    } catch (err: any) {
      set({ loading: false, error: err?.message || String(err) });
    }
  },

  loadCatalog: async () => {
    try {
      const res = await window.codeBrainApp.recipe.getCatalog();
      if (res?.ok && res.data) {
        set({
          catalog: res.data.items || [],
          catalogUpdatedAt: res.data.updatedAt || null,
        });
      }
    } catch {}
  },

  loadSavedRecipes: async () => {
    try {
      const res = await window.codeBrainApp.recipe.list();
      if (res?.ok) {
        set({ savedRecipes: res.data || [] });
      }
    } catch {}
  },

  loadIngredients: async () => {
    try {
      const res = await window.codeBrainApp.recipe.ingredients();
      if (res?.ok && res.data) {
        set({ ingredients: res.data });
      }
    } catch {}
  },

  saveRecipe: async (recipe: Recipe) => {
    try {
      const res = await window.codeBrainApp.recipe.save({ recipe });
      if (res?.ok) {
        // Reload saved recipes
        await get().loadSavedRecipes();
        return true;
      }
      set({ error: res?.error || "Failed to save recipe" });
      return false;
    } catch (err: any) {
      set({ error: err?.message || String(err) });
      return false;
    }
  },

  deleteRecipe: async (name: string) => {
    try {
      const res = await window.codeBrainApp.recipe.delete({ name });
      if (res?.ok) {
        await get().loadSavedRecipes();
        return true;
      }
      set({ error: res?.error || "Failed to delete recipe" });
      return false;
    } catch (err: any) {
      set({ error: err?.message || String(err) });
      return false;
    }
  },

  clearError: () => set({ error: null }),
  clearProposed: () => set({ proposedRecipes: [] }),
}));
