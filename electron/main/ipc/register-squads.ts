import { ipcMain } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AppContext } from "../context";
import { safeSend } from "../context";

const SQUADS_FILE_NAME = "squads.json";

function getSquadsFilePath(ctx: AppContext): string {
  return path.join(ctx.DATA_DIR, SQUADS_FILE_NAME);
}

function readSquads(ctx: AppContext): unknown[] {
  const filePath = getSquadsFilePath(ctx);
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSquads(ctx: AppContext, squads: unknown[]): void {
  const filePath = getSquadsFilePath(ctx);
  fs.writeFileSync(filePath, JSON.stringify(squads, null, 2), "utf-8");
}

function broadcastSquads(ctx: AppContext): void {
  const squads = readSquads(ctx);
  safeSend(ctx, "squads:updated", squads);
}

export function registerSquadHandlers(ctx: AppContext): void {
  ipcMain.handle("squads:list", () => {
    return readSquads(ctx);
  });

  ipcMain.handle("squads:save", (_event, squad: any) => {
    if (!squad || typeof squad !== "object" || !squad.id) {
      return { ok: false, error: "Invalid squad: missing id" };
    }
    const squads = readSquads(ctx);
    const idx = squads.findIndex((s: any) => s.id === squad.id);
    if (idx >= 0) {
      squads[idx] = squad;
    } else {
      squads.push(squad);
    }
    writeSquads(ctx, squads);
    broadcastSquads(ctx);
    return { ok: true };
  });

  ipcMain.handle("squads:delete", (_event, id: string) => {
    if (!id) return { ok: false, error: "Missing id" };
    const squads = readSquads(ctx);
    const filtered = squads.filter((s: any) => s.id !== id);
    if (filtered.length === squads.length) {
      return { ok: false, error: "Squad not found" };
    }
    writeSquads(ctx, filtered);
    broadcastSquads(ctx);
    return { ok: true };
  });
}
