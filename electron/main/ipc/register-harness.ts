/**
 * IPC da tabela de harness, findings, catálogo, contas e mídia. Chaves de API
 * ficam aqui no main process; o renderer só recebe id, nome e modelos.
 */
import { app, ipcMain } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { AppContext } from "../context";
import { GLOBAL_DIR } from "../services/constants";
import { spawnPaneInternal } from "../services/pane-spawn";
import { getEnhancedProviders } from "../services/providers";
import { getCliDecider } from "../services/cli-decider";
import {
  addAccount,
  getAccount,
  listAccountStatus,
  removeAccount,
  setLockedAccount,
  type AccountCli,
} from "../services/accounts";
import { copyCatalogTo, listAgents, scanCatalog, setCatalogMeta } from "../services/catalog";
import {
  deciderCredentials,
  listDeciderProviders,
  mediaCredentials,
  type HarnessProvider,
} from "../services/harness-providers";

const MAX_IMAGE_PREVIEWS = 60;
const MAX_PREVIEW_BYTES = 12 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const bridgeModule = (file: string) =>
  require(path.join(app.getAppPath(), "packages", "mcp", "bridge", file));
const harnessTablePath = () => path.join(GLOBAL_DIR, "harness.json");

/** Handler que devolve `{ ok: false, error }` em vez de rejeitar no renderer. */
function handle(channel: string, fn: (args: any) => unknown): void {
  ipcMain.handle(channel, async (_event, args) => {
    try {
      return await fn(args ?? {});
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/**
 * A CSP do renderer aceita `data:` em imagens e bloqueia `file:`. Vídeo não tem
 * como tocar inline sob a mesma CSP, então leva o endereço do arquivo.
 */
function withPreviewUrl(items: { path: string; kind: string }[]) {
  let previews = 0;
  return items.map((item) => {
    if (item.kind !== "image") return { ...item, url: pathToFileURL(item.path).href };
    const mime = IMAGE_MIME[path.extname(item.path).toLowerCase()];
    if (!mime || previews >= MAX_IMAGE_PREVIEWS) return { ...item, url: "" };
    try {
      if (fs.statSync(item.path).size > MAX_PREVIEW_BYTES) return { ...item, url: "" };
      previews += 1;
      return {
        ...item,
        url: `data:${mime};base64,${fs.readFileSync(item.path).toString("base64")}`,
      };
    } catch {
      return { ...item, url: "" };
    }
  });
}

export function registerHarnessHandlers(ctx: AppContext): void {
  const providers = () => getEnhancedProviders(ctx) as HarnessProvider[];
  const store = () => {
    const memoryStore = ctx.memoryStore as any;
    if (!memoryStore) throw new Error("memória indisponível");
    return memoryStore;
  };

  // ── Tabela de harness ─────────────────────────────────────────────────────
  handle("harness:getTable", () => ({
    ok: true,
    table: bridgeModule("harness.js").loadHarnessTable(harnessTablePath()),
  }));
  handle("harness:saveTable", (table) => ({
    ok: true,
    table: bridgeModule("harness.js").saveHarnessTable(harnessTablePath(), table),
  }));
  handle("harness:receipts", ({ workspace }) => store().listSpawnReceipts({ workspace }));
  handle("harness:deciderProviders", async () => ({
    ok: true,
    providers: [
      ...await getCliDecider(ctx).listProviders(),
      ...listDeciderProviders(providers()).map(provider => ({ ...provider, transport: "api" as const })),
    ],
  }));
  handle("harness:testDecider", async ({ prompt }) => {
    if (typeof prompt !== "string" || !prompt.trim())
      return {
        ok: false,
        decision: null,
        reason: "prompt obrigatório",
        error: "prompt obrigatório",
      };
    const table = bridgeModule("harness.js").loadHarnessTable(harnessTablePath());
    const { decision, reason } = await bridgeModule("decider.js").consultDecider({
      prompt,
      rows: table.rows,
      agents: listAgents(ctx.currentWorkspacePath),
      idleWorkers: [],
      // O teste roda mesmo com o decisor desligado na tabela.
      config: { ...table.decider, enabled: true },
      credentials: deciderCredentials(providers(), table.decider?.providerId),
      runCliDecider: args => getCliDecider(ctx).run(args),
    });
    if (!decision) return { ok: false, decision: null, reason, error: reason };
    const taskName = table.rows.find((row: { id: string }) => row.id === decision.taskId)?.name;
    return { ok: true, decision, reason: decision.reason, taskName };
  });

  // ── Findings ──────────────────────────────────────────────────────────────
  handle("findings:list", ({ workspace, status }) =>
    store().findingList({ workspace: workspace ?? ctx.currentWorkspacePath, status })
  );
  handle("findings:update", (args) =>
    store().findingUpdate({ ...args, workspace: args.workspace ?? ctx.currentWorkspacePath })
  );
  handle("findings:stats", ({ workspace }) =>
    store().findingStats({ workspace: workspace ?? ctx.currentWorkspacePath })
  );

  // ── Catálogo ──────────────────────────────────────────────────────────────
  handle("agentCatalog:scan", ({ workspace }) => ({
    ok: true,
    items: scanCatalog(workspace ?? ctx.currentWorkspacePath),
  }));
  handle("agentCatalog:setMeta", (update) => {
    setCatalogMeta(update);
    return { ok: true };
  });
  handle("agentCatalog:copyTo", ({ name, cli, workspace, kind }) => ({
    ok: true,
    ...copyCatalogTo(name, cli, workspace ?? ctx.currentWorkspacePath, kind ?? "skill"),
  }));

  // ── Contas ────────────────────────────────────────────────────────────────
  handle("accounts:list", async () => ({ ok: true, accounts: await listAccountStatus() }));
  handle("accounts:add", ({ cli, label }) => ({ ok: true, account: addAccount(cli, label) }));
  handle("accounts:remove", ({ id }) => {
    removeAccount(id);
    return { ok: true };
  });
  handle("accounts:lock", ({ cli, id }) => {
    setLockedAccount(cli, id ?? null);
    return { ok: true };
  });
  handle("accounts:login", async ({ id, cwd }) => {
    const account = getAccount(id);
    if (!account) return { ok: false, error: "conta não encontrada" };
    const result = await spawnPaneInternal(ctx, {
      agent: account.cli,
      providerId: `${account.cli}-oauth`,
      cwd,
      accountId: account.id,
      accountLabel: account.label,
      label: `Login ${account.label}`,
      permissionMode: "default",
    });
    return result.ok ? { ok: true, paneId: result.paneId } : { ok: false, error: result.error };
  });

  // ── Mídia ─────────────────────────────────────────────────────────────────
  const media = () =>
    bridgeModule("media-handlers.js").createMediaHandlers({
      getMediaCredentials: () => mediaCredentials(providers()),
      getCurrentWorkspacePath: () => ctx.currentWorkspacePath,
    });
  handle("media:providers", () => media().mediaProviders());
  handle("media:list", ({ workspace }) => {
    const { items } = media().mediaList({ workspace });
    return { ok: true, items: withPreviewUrl(items) };
  });
  handle("media:generate", (args) => media().mediaGenerate(args));
}
