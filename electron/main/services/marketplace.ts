import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

// These are repository sources, not a curated/fabricated list of skills.
export const MARKETPLACE_SOURCES = [
  { id: "anthropic", name: "Anthropic", repo: "anthropics/skills" },
  { id: "vercel", name: "Vercel", repo: "vercel-labs/agent-skills" },
] as const;

export interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  type: "prompt";
  version: string;
  entrypoint: string;
  source: string;
  sourceId: string;
  sourceUrl: string;
  installed: boolean;
  scope?: string;
  localId?: string;
  path?: string;
}

export interface MarketplaceSourceStatus {
  id: string;
  name: string;
  url: string;
  status: "online" | "cached" | "unavailable";
  fetchedAt?: string;
  error?: string;
}

export interface MarketplaceIndex {
  ok: boolean;
  index: { skills: MarketplaceSkill[] };
  installed: MarketplaceSkill[];
  sources: MarketplaceSourceStatus[];
  error?: string;
}

interface TreeEntry { path: string; type: string; mode: string; sha: string; size?: number }
interface Snapshot { revision: string; fetchedAt: string; tree: TreeEntry[]; skills: MarketplaceSkill[] }
type Source = (typeof MARKETPLACE_SOURCES)[number];
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_INSTALL_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 2000;
const SHA = /^[a-f0-9]{40}$/;

/** Parse display metadata only. Never evaluate YAML tags or skill instructions. */
export function marketplaceMetadata(text: string): { name?: string; description?: string } {
  const header = text.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!header) return {};
  const result: Record<string, string> = {};
  let key = "";
  for (const line of header.split(/\r?\n/)) {
    const match = /^(name|description):\s*(.*)$/.exec(line);
    if (match) {
      key = match[1];
      result[key] = /^[>|][-+]?\s*$/.test(match[2]) ? "" : match[2].replace(/^(['"])([\s\S]*)\1$/, "$2");
    } else if (key && /^\s+\S/.test(line)) result[key] += ` ${line.trim()}`;
    else key = "";
  }
  return { name: result.name?.trim().slice(0, 200), description: result.description?.trim().slice(0, 2000) };
}

export function safeMarketplacePath(relative: string): string[] {
  const parts = relative.split("/");
  if (!relative || parts.some(part => !part || part === "." || part === ".." ||
    /[\\:\x00-\x1f<>"|?*]/.test(part) || /[. ]$/.test(part) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(`Caminho de arquivo inválido: ${relative}`);
  }
  return parts;
}

export function createMarketplace(options: {
  homeDir: string;
  skillsDir: string;
  cachePath: string;
  fetch?: typeof globalThis.fetch;
}) {
  const request = options.fetch ?? globalThis.fetch;
  const snapshots = new Map<string, Snapshot>();
  let loaded = false;
  let pending: Promise<MarketplaceIndex> | undefined;
  const installing = new Set<string>();

  async function readBytes(url: string, limit: number): Promise<Buffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await request(url, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "CodeBrain-Marketplace" },
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}${response.status === 403 || response.status === 429 ? " (limite de acesso ao GitHub)" : ""}`);
      if (Number(response.headers.get("content-length")) > limit) throw new Error("Arquivo excede o limite de tamanho");
      if (!response.body) throw new Error("Resposta vazia");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > limit) throw new Error("Arquivo excede o limite de tamanho");
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      return Buffer.concat(chunks);
    } finally { clearTimeout(timeout); }
  }

  const rawUrl = (source: Source, revision: string, file: string) =>
    `https://raw.githubusercontent.com/${source.repo}/${revision}/${file.split("/").map(encodeURIComponent).join("/")}`;

  async function loadCache() {
    if (loaded) return;
    loaded = true;
    try {
      const cache = JSON.parse(await fs.readFile(options.cachePath, "utf8"));
      if (cache.version !== 1) return;
      for (const source of MARKETPLACE_SOURCES) {
        const snapshot = cache.sources?.[source.id];
        if (snapshot && SHA.test(snapshot.revision) && Array.isArray(snapshot.tree) && Array.isArray(snapshot.skills) &&
          snapshot.skills.every((skill: MarketplaceSkill) => skill.sourceId === source.id && typeof skill.id === "string" && typeof skill.name === "string")) {
          snapshots.set(source.id, snapshot);
        }
      }
    } catch { /* Missing cache is normal on first launch. */ }
  }

  async function saveCache() {
    let temporary: string | undefined;
    try {
      await fs.mkdir(path.dirname(options.cachePath), { recursive: true });
      temporary = `${options.cachePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify({ version: 1, sources: Object.fromEntries(snapshots) }), { flag: "wx" });
      await fs.rename(temporary, options.cachePath);
    } catch { /* A cache write failure must not hide a usable online catalog. */ }
    finally { if (temporary) await fs.rm(temporary, { force: true }).catch(() => {}); }
  }

  async function fetchSnapshot(source: Source): Promise<Snapshot> {
    const json = JSON.parse((await readBytes(`https://api.github.com/repos/${source.repo}/git/trees/main?recursive=1`, MAX_FILE_BYTES)).toString("utf8"));
    if (!SHA.test(json.sha) || !Array.isArray(json.tree) || json.truncated) throw new Error("GitHub retornou uma árvore incompleta ou inválida");
    const previous = snapshots.get(source.id);
    if (previous?.revision === json.sha) return { ...previous, fetchedAt: new Date().toISOString() };
    const entries = (json.tree as TreeEntry[]).filter(entry => entry.type === "blob" && entry.mode === "100644" && /^skills\/[^/]+\/SKILL\.md$/.test(entry.path));
    if (!entries.length) throw new Error("Nenhuma skill encontrada na fonte");
    const skills: MarketplaceSkill[] = [];
    // Bounded concurrency avoids making one request per skill simultaneously.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, entries.length) }, async () => {
      while (next < entries.length) {
        const entry = entries[next++];
        safeMarketplacePath(entry.path);
        const slug = entry.path.split("/")[1];
        const text = (await readBytes(rawUrl(source, json.sha, entry.path), MAX_FILE_BYTES)).toString("utf8");
        const metadata = marketplaceMetadata(text);
        skills.push({
          id: `${source.id}:${slug}`, name: metadata.name || slug, description: metadata.description || "",
          type: "prompt", version: json.sha, entrypoint: "SKILL.md", source: source.name, sourceId: source.id,
          sourceUrl: `https://github.com/${source.repo}/tree/${json.sha}/skills/${encodeURIComponent(slug)}`, installed: false,
        });
      }
    }));
    return { revision: json.sha, fetchedAt: new Date().toISOString(), tree: json.tree, skills: skills.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  async function installedInventory(): Promise<MarketplaceSkill[]> {
    const items: MarketplaceSkill[] = [];
    for (const scope of ["codebrain", "claude", "codex", "agents"]) {
      const root = scope === "codebrain" ? options.skillsDir : path.join(options.homeDir, `.${scope}`, "skills");
      const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.isSymbolicLink() || (!entry.isDirectory() && !entry.name.endsWith(".md"))) continue;
        const location = path.join(root, entry.name);
        let manifest: Record<string, any> = {};
        if (entry.isDirectory()) {
          try { manifest = JSON.parse(await fs.readFile(path.join(location, "skill.json"), "utf8")); } catch { /* SKILL.md format */ }
        }
        const metadata = marketplaceMetadata(await fs.readFile(entry.isDirectory() ? path.join(location, "SKILL.md") : location, "utf8").catch(() => ""));
        items.push({
          id: `local:${scope}:${entry.name}`, localId: entry.name, name: typeof manifest.name === "string" ? manifest.name : metadata.name || entry.name.replace(/\.md$/, ""),
          description: typeof manifest.description === "string" ? manifest.description : metadata.description || "",
          type: "prompt", version: typeof manifest.version === "string" ? manifest.version : "", entrypoint: "SKILL.md",
          source: `.${scope}/skills`, sourceId: typeof manifest.marketplace?.id === "string" ? manifest.marketplace.id : "local",
          sourceUrl: "", scope, path: location, installed: true,
        });
      }
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function buildIndex(): Promise<MarketplaceIndex> {
    await loadCache();
    const installedPromise = installedInventory();
    const sources = await Promise.all(MARKETPLACE_SOURCES.map(async source => {
      const base = { id: source.id, name: source.name, url: `https://github.com/${source.repo}` };
      try {
        const snapshot = await fetchSnapshot(source);
        snapshots.set(source.id, snapshot);
        return { ...base, status: "online" as const, fetchedAt: snapshot.fetchedAt };
      } catch (error) {
        const cached = snapshots.get(source.id);
        return { ...base, status: cached ? "cached" as const : "unavailable" as const, fetchedAt: cached?.fetchedAt, error: error instanceof Error ? error.message : String(error) };
      }
    }));
    await saveCache();
    const installed = await installedPromise;
    const provenance = new Set(installed.map(item => item.sourceId));
    const skills = MARKETPLACE_SOURCES.flatMap(source => snapshots.get(source.id)?.skills ?? []).map(item => ({ ...item, installed: provenance.has(item.id) }));
    return { ok: skills.length > 0, index: { skills }, installed, sources,
      ...(skills.length ? {} : { error: "Não foi possível carregar o catálogo online. Verifique a conexão e tente atualizar." }) };
  }

  function registryIndex(): Promise<MarketplaceIndex> {
    if (!pending) pending = buildIndex().finally(() => { pending = undefined; });
    return pending;
  }

  async function install(id: string) {
    if (typeof id !== "string" || !/^(anthropic|vercel):[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Identificador de skill inválido");
    if (installing.has(id)) throw new Error("Esta skill já está sendo instalada");
    installing.add(id);
    let staging: string | undefined;
    try {
      await loadCache();
      const [sourceId, slug] = id.split(":");
      const source = MARKETPLACE_SOURCES.find(item => item.id === sourceId)!;
      if (!snapshots.has(sourceId)) snapshots.set(sourceId, await fetchSnapshot(source));
      const snapshot = snapshots.get(sourceId)!;
      const skill = snapshot.skills.find(item => item.id === id);
      if (!skill) throw new Error("Skill não encontrada no catálogo oficial. Atualize o catálogo.");
      const prefix = `skills/${slug}/`;
      const files = snapshot.tree.filter(entry => typeof entry.path === "string" && entry.path.startsWith(prefix) && entry.type !== "tree");
      if (!files.some(file => file.path === `${prefix}SKILL.md`) || files.length > MAX_FILES) throw new Error("Pacote vazio ou excede o limite de 2.000 arquivos");
      let expectedBytes = 0;
      const paths = new Set<string>();
      for (const file of files) {
        const relative = file.path.slice(prefix.length);
        safeMarketplacePath(relative);
        if (file.type !== "blob" || !["100644", "100755"].includes(file.mode) || !SHA.test(file.sha)) throw new Error("Links simbólicos, submódulos ou arquivos inválidos não são suportados");
        if (paths.has(relative.toLowerCase()) || relative.toLowerCase() === "skill.json") throw new Error("Pacote contém caminhos conflitantes ou reservados");
        paths.add(relative.toLowerCase());
        if (!Number.isSafeInteger(file.size) || file.size! < 0 || file.size! > MAX_FILE_BYTES) throw new Error("Arquivo excede o limite de 8 MB");
        expectedBytes += file.size!;
      }
      if (expectedBytes > MAX_INSTALL_BYTES) throw new Error("Pacote excede o limite de 64 MB");
      await fs.mkdir(options.skillsDir, { recursive: true });
      const root = await fs.realpath(options.skillsDir);
      const localId = `${sourceId}--${slug}`;
      const destination = path.join(root, localId);
      // Never replace an existing user directory or follow an existing symlink.
      if (await fs.lstat(destination).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) {
        throw new Error("Já existe uma skill neste destino. Remova-a antes de instalar novamente.");
      }
      staging = await fs.mkdtemp(path.join(root, ".marketplace-"));
      let downloaded = 0;
      for (const file of files) {
        const bytes = await readBytes(rawUrl(source, snapshot.revision, file.path), MAX_FILE_BYTES);
        downloaded += bytes.length;
        if (downloaded > MAX_INSTALL_BYTES || bytes.length !== file.size) throw new Error("Tamanho do pacote divergente ou acima do limite");
        const digest = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
        if (digest !== file.sha) throw new Error("Integridade do arquivo não confere com a revisão do catálogo");
        const target = path.join(staging, ...safeMarketplacePath(file.path.slice(prefix.length)));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bytes, { flag: "wx", mode: file.mode === "100755" ? 0o755 : 0o644 });
      }
      const manifest = {
        id: localId, name: skill.name, description: skill.description, version: snapshot.revision,
        type: "prompt" as const, entrypoint: "SKILL.md", author: source.name,
        marketplace: { id, repo: source.repo, revision: snapshot.revision },
      };
      await fs.writeFile(path.join(staging, "skill.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
      await fs.rename(staging, destination);
      staging = undefined;
      return { ok: true as const, manifest, path: destination };
    } finally {
      installing.delete(id);
      if (staging) await fs.rm(staging, { recursive: true, force: true });
    }
  }

  return { registryIndex, installedInventory, install };
}
