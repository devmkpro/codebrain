import { ipcMain } from "electron";
import type { AppContext } from "../context";

/**
 * IPC handlers for the Recipe / Harness feature.
 * Exposes recipe operations to the renderer (UI) layer.
 */
export function registerRecipeHandlers(ctx: AppContext): void {
  /**
   * Get the MCP bridge instance for recipe operations.
   * The bridge is created during MCP startup and stored on ctx.
   */
  function getBridge(): any {
    return (ctx as any)._mcpBridge;
  }

  // ── Enrich Catalog ──────────────────────────────────────────────────────
  ipcMain.handle("recipe:enrich-catalog", async (_event, args?: { model?: string; force?: boolean }) => {
    try {
      const bridge = getBridge();
      if (!bridge?.recipeEnrichCatalog) {
        return { ok: false, error: "Recipe handlers not available" };
      }
      return await bridge.recipeEnrichCatalog(args || {});
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ── Propose Recipes ─────────────────────────────────────────────────────
  ipcMain.handle("recipe:propose", async (_event, args?: {
    model?: string;
    agents?: string[];
    skills?: string[];
    llms?: string[];
  }) => {
    try {
      const bridge = getBridge();
      if (!bridge?.recipePropose) {
        return { ok: false, error: "Recipe handlers not available" };
      }
      return await bridge.recipePropose(args || {});
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ── Get Catalog (cached) ────────────────────────────────────────────────
  ipcMain.handle("recipe:get-catalog", async () => {
    try {
      const bridge = getBridge();
      if (!bridge?.recipeGetCatalog) {
        return { ok: false, error: "Recipe handlers not available" };
      }
      return await bridge.recipeGetCatalog();
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ── Save Recipe ─────────────────────────────────────────────────────────
  ipcMain.handle("recipe:save", async (_event, args: { recipe: any }) => {
    try {
      const bridge = getBridge();
      if (!bridge?.recipeSave) {
        return { ok: false, error: "Recipe handlers not available" };
      }
      return await bridge.recipeSave(args);
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ── List Recipes ────────────────────────────────────────────────────────
  ipcMain.handle("recipe:list", async () => {
    try {
      const bridge = getBridge();
      if (!bridge?.recipeList) {
        return { ok: false, error: "Recipe handlers not available" };
      }
      return await bridge.recipeList();
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ── Delete Recipe ───────────────────────────────────────────────────────
  ipcMain.handle("recipe:delete", async (_event, args: { name: string }) => {
    try {
      const bridge = getBridge();
      if (!bridge?.recipeDelete) {
        return { ok: false, error: "Recipe handlers not available" };
      }
      return await bridge.recipeDelete(args);
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ── Get Ingredients ─────────────────────────────────────────────────────
  ipcMain.handle("recipe:ingredients", async () => {
    try {
      const bridge = getBridge();
      if (!bridge?.recipeIngredients) {
        return { ok: false, error: "Recipe handlers not available" };
      }
      return await bridge.recipeIngredients();
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
}
