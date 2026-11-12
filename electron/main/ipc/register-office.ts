import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserWindow } from "electron";
import type { AppContext } from "../context";

/**
 * Escritório (office pane): avisa o renderer quando um pane manda mensagem
 * para outro, para o personagem do remetente andar até o destinatário.
 *
 * As mensagens de pane_send_message ficam em ~/.codebrain/messages/<para>/<id>.json
 * (packages/mcp/index.js). Só from/to/type saem daqui; o conteúdo não vai
 * para o renderer.
 */
const MESSAGES_DIR = path.join(os.homedir(), ".codebrain", "messages");
const MAX_AGE_MS = 15_000;
const SEEN_LIMIT = 500;
const PANE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface OfficeMessageEvent {
  id: string;
  from: string;
  to: string;
  type: string;
  timestamp: number;
}

export function parseOfficeMessage(raw: string, now = Date.now()): OfficeMessageEvent | null {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object") return null;
  const { id, from, to, type, timestamp } = msg;
  if (typeof id !== "string" || !PANE_ID.test(String(from)) || !PANE_ID.test(String(to))) return null;
  if (from === to) return null;
  if (typeof timestamp !== "number" || now - timestamp > MAX_AGE_MS) return null;
  return { id, from, to, type: typeof type === "string" ? type : "update", timestamp };
}

function broadcast(event: OfficeMessageEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send("office:message", event);
    } catch {}
  }
}

export function registerOfficeHandlers(_ctx: AppContext): void {
  try {
    fs.mkdirSync(MESSAGES_DIR, { recursive: true });
  } catch {}
  const seen = new Set<string>();
  const handleFile = (relative: string | null) => {
    if (!relative || !relative.endsWith(".json")) return;
    const file = path.join(MESSAGES_DIR, relative);
    // The writer fsyncs right after writing; a short delay avoids reading a partial file.
    setTimeout(() => {
      fs.readFile(file, "utf-8", (err, raw) => {
        if (err) return;
        const event = parseOfficeMessage(raw);
        if (!event || seen.has(event.id)) return;
        seen.add(event.id);
        if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as string);
        broadcast(event);
      });
    }, 60);
  };
  try {
    const watcher = fs.watch(MESSAGES_DIR, { recursive: true }, (_event, filename) => {
      handleFile(filename ? String(filename) : null);
    });
    watcher.on("error", (err) => console.warn("[office] messages watcher error:", err));
  } catch (err) {
    console.warn("[office] cannot watch messages dir:", err);
  }
}
