/**
 * Várias contas por CLI ("Redline"): cada conta extra é um diretório de
 * configuração próprio, e o spawn escolhe a que tem mais folga.
 *
 * `pickAccount` é síncrono de propósito: roda no meio da decisão do spawn, então
 * só consulta o cache que `startUsageRefresh` mantém atualizado.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getHarness } from "./spawn/cli-registry";
import { collectClaudeUsage, readCodexRateLimits, type UsageWindow } from "./account-usage";

interface AccountCliSpec {
  label: string;
  /** Diretório da conta padrão, relativo à home. */
  defaultDir: string;
  /** Variável que aponta a CLI para outro diretório de configuração. */
  configDirEnv: string;
  /** Qualquer um destes arquivos no diretório significa sessão iniciada. */
  credentialFiles: readonly string[];
  /** A conta padrão guarda o token no Keychain do macOS, não em arquivo. */
  defaultUsesKeychain?: boolean;
  collectUsage?: (configDir: string) => Promise<UsageWindow[]>;
}

/** Suportar outra CLI com variável de diretório é acrescentar uma linha aqui. */
const ACCOUNT_CLI_SPECS = {
  claude: {
    label: "Claude",
    defaultDir: ".claude",
    configDirEnv: "CLAUDE_CONFIG_DIR",
    credentialFiles: [".credentials.json"],
    defaultUsesKeychain: true,
    collectUsage: (configDir) => collectClaudeUsage(configDir),
  },
  codex: {
    label: "Codex",
    defaultDir: ".codex",
    configDirEnv: "CODEX_HOME",
    credentialFiles: ["auth.json"],
    collectUsage: (configDir) => readCodexRateLimits(configDir),
  },
} satisfies Record<string, AccountCliSpec>;

export type AccountCli = keyof typeof ACCOUNT_CLI_SPECS;

const specOf = (cli: AccountCli): AccountCliSpec => ACCOUNT_CLI_SPECS[cli];

export interface CliAccount {
  id: string;
  cli: AccountCli;
  label: string;
  configDir: string;
  isDefault: boolean;
}

export interface AccountStatus extends CliAccount {
  locked: boolean;
  loggedIn: boolean;
  windows: UsageWindow[];
  usedPct: number | null;
}

interface AccountsState {
  accounts: CliAccount[];
  locked: Partial<Record<AccountCli, string>>;
}

const CLIS = Object.keys(ACCOUNT_CLI_SPECS) as AccountCli[];
const USAGE_TTL_MS = 60_000;
const NEAR_LIMIT_PCT = 95;
const NEAR_LIMIT_NOTE = "todas as contas perto do limite";

const codebrainDir = () => path.join(os.homedir(), ".codebrain");
const statePath = () => path.join(codebrainDir(), "accounts.json");
export const accountsRootDir = () => path.join(codebrainDir(), "accounts");

const isCli = (value: unknown): value is AccountCli =>
  CLIS.includes(value as AccountCli) &&
  Boolean(getHarness(value as string)?.capabilities.multiAccount);

function defaultAccounts(): CliAccount[] {
  return CLIS.map((cli) => ({
    id: `${cli}-default`,
    cli,
    label: `${specOf(cli).label} (padrão)`,
    configDir: path.join(os.homedir(), specOf(cli).defaultDir),
    isDefault: true,
  }));
}

function readState(): AccountsState {
  const defaults = defaultAccounts();
  let raw: any = {};
  try {
    raw = JSON.parse(fs.readFileSync(statePath(), "utf-8"));
  } catch {
    // primeiro uso, ou arquivo corrompido: só as contas padrão
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
  const seen = new Set<string>();
  const extras: CliAccount[] = (Array.isArray(raw.accounts) ? raw.accounts : [])
    .filter(
      (account: any) =>
        isCli(account?.cli) &&
        typeof account.id === "string" &&
        /^[a-z0-9-]{1,100}$/.test(account.id) &&
        !account.id.endsWith("-default") &&
        !seen.has(account.id) &&
        seen.add(account.id)
    )
    .map((account: any) => ({
      id: account.id,
      cli: account.cli,
      label: String(account.label || account.id).slice(0, 40),
      // Derivado do id: um arquivo adulterado não aponta conta para outro lugar.
      configDir: path.join(accountsRootDir(), account.id),
      isDefault: false,
    }));
  const accounts = [...defaults, ...extras];
  const locked: AccountsState["locked"] = {};
  for (const cli of CLIS) {
    const id = raw.locked?.[cli];
    if (accounts.some((account) => account.id === id && account.cli === cli)) locked[cli] = id;
  }
  return { accounts, locked };
}

function writeState(state: AccountsState): void {
  fs.mkdirSync(codebrainDir(), { recursive: true });
  const target = statePath();
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tmp, target);
}

export const listAccounts = (): CliAccount[] => readState().accounts;

export const getAccount = (id: string | null | undefined): CliAccount | null =>
  (id ? readState().accounts.find((account) => account.id === id) : null) ?? null;

export function addAccount(cli: AccountCli, label: string): CliAccount {
  if (!isCli(cli)) throw new Error("CLI não suporta várias contas");
  const name = typeof label === "string" ? label.trim() : "";
  if (!name) throw new Error("informe um nome para a conta");
  const state = readState();
  const slug =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "conta";
  const id = `${cli}-${slug}-${Math.random().toString(36).slice(2, 7)}`;
  const account: CliAccount = {
    id,
    cli,
    label: name.slice(0, 40),
    configDir: path.join(accountsRootDir(), id),
    isDefault: false,
  };
  fs.mkdirSync(account.configDir, { recursive: true });
  state.accounts.push(account);
  writeState(state);
  return account;
}

function isInsideAccountsDir(target: string): boolean {
  const relative = path.relative(path.resolve(accountsRootDir()), path.resolve(target));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function removeAccount(id: string): void {
  const state = readState();
  const account = state.accounts.find((candidate) => candidate.id === id);
  if (!account) throw new Error("conta não encontrada");
  if (account.isDefault) throw new Error("a conta padrão não pode ser removida");
  state.accounts = state.accounts.filter((candidate) => candidate.id !== id);
  if (state.locked[account.cli] === id) delete state.locked[account.cli];
  writeState(state);
  usageCache.delete(id);
  if (isInsideAccountsDir(account.configDir))
    fs.rmSync(account.configDir, { recursive: true, force: true });
}

/** `id` nulo destrava a CLI. */
export function setLockedAccount(cli: AccountCli, id: string | null): void {
  if (!isCli(cli)) throw new Error("CLI não suporta várias contas");
  const state = readState();
  if (id === null) delete state.locked[cli];
  else {
    if (!state.accounts.some((account) => account.id === id && account.cli === cli))
      throw new Error("conta não encontrada");
    state.locked[cli] = id;
  }
  writeState(state);
}

/** Conta padrão não leva variável: a CLI já usa o diretório dela. */
export function accountEnv(accountId: string | null | undefined): Record<string, string> {
  const account = getAccount(accountId);
  if (!account || account.isDefault) return {};
  return { [specOf(account.cli).configDirEnv]: account.configDir };
}

export function accountSkillDirs(): { cli: AccountCli; dir: string }[] {
  return listAccounts().map((account) => ({
    cli: account.cli,
    dir: path.join(account.configDir, "skills"),
  }));
}

export function isLoggedIn(account: CliAccount): boolean {
  const spec = specOf(account.cli);
  if (account.isDefault && spec.defaultUsesKeychain && process.platform === "darwin") return true;
  return spec.credentialFiles.some((file) => fs.existsSync(path.join(account.configDir, file)));
}

// ── Uso ─────────────────────────────────────────────────────────────────────

const usageCache = new Map<string, { at: number; windows: UsageWindow[] }>();
let refreshing: Promise<void> | null = null;

const collectUsage = async (account: CliAccount): Promise<UsageWindow[]> =>
  (await specOf(account.cli).collectUsage?.(account.configDir)) ?? [];

function refreshUsage(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    for (const account of listAccounts()) {
      if (!isLoggedIn(account)) continue;
      const cached = usageCache.get(account.id);
      if (cached && Date.now() - cached.at < USAGE_TTL_MS) continue;
      try {
        usageCache.set(account.id, { at: Date.now(), windows: await collectUsage(account) });
      } catch {
        // uso é informativo: a conta continua utilizável sem ele
      }
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function usedPctOf(windows: UsageWindow[]): number | null {
  const known = windows
    .map((window) =>
      window.resetsAt !== null && window.resetsAt <= Date.now() ? 0 : window.usedPct
    )
    .filter((pct): pct is number => typeof pct === "number" && Number.isFinite(pct));
  return known.length ? Math.max(...known) : null;
}

export async function listAccountStatus(): Promise<AccountStatus[]> {
  await refreshUsage();
  const { accounts, locked } = readState();
  return accounts.map((account) => {
    const windows = usageCache.get(account.id)?.windows ?? [];
    return {
      ...account,
      locked: locked[account.cli] === account.id,
      loggedIn: isLoggedIn(account),
      windows,
      usedPct: usedPctOf(windows),
    };
  });
}

/** Percentual conhecido manda; sem ele, compara tokens gastos nas 5 horas. */
function compareLoad(a: CliAccount, b: CliAccount): number {
  const windowsA = usageCache.get(a.id)?.windows ?? [];
  const windowsB = usageCache.get(b.id)?.windows ?? [];
  const pctA = usedPctOf(windowsA);
  const pctB = usedPctOf(windowsB);
  if (pctA !== null && pctB !== null) return pctA - pctB;
  if (pctA === null && pctB === null) {
    const tokens = (windows: UsageWindow[]) =>
      windows.find((window) => window.id === "5h")?.tokens ?? 0;
    return tokens(windowsA) - tokens(windowsB);
  }
  // Sem medição só perde para conta medida com folga.
  const known = pctA ?? pctB ?? 0;
  const knownWins = known < NEAR_LIMIT_PCT;
  return (pctA !== null) === knownWins ? -1 : 1;
}

export function pickAccount(
  cli: string,
  requestedId?: string | null
): { id: string; label: string; note?: string } | null {
  if (!isCli(cli)) return null;
  const { accounts, locked } = readState();
  const available = accounts.filter((account) => account.cli === cli && isLoggedIn(account));
  const pinned =
    available.find((account) => account.id === requestedId) ??
    available.find((account) => account.id === locked[cli]);
  if (pinned) return { id: pinned.id, label: pinned.label };
  if (!available.length || (available.length === 1 && available[0].isDefault)) return null;

  const best = [...available].sort(compareLoad)[0];
  const bestPct = usedPctOf(usageCache.get(best.id)?.windows ?? []);
  return bestPct !== null && bestPct >= NEAR_LIMIT_PCT
    ? { id: best.id, label: best.label, note: NEAR_LIMIT_NOTE }
    : { id: best.id, label: best.label };
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;

export function startUsageRefresh(): void {
  if (refreshTimer) return;
  void refreshUsage();
  refreshTimer = setInterval(() => void refreshUsage(), USAGE_TTL_MS);
  refreshTimer.unref?.();
}

/** Só para testes: injeta o uso que `pickAccount` vai enxergar. */
export function seedUsageForTest(id: string, windows: UsageWindow[]): void {
  usageCache.set(id, { at: Date.now(), windows });
}
