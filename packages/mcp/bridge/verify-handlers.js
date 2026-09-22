"use strict";

/* ═══════════════════════════════════════════════════════════════════════════
   VERIFICAÇÃO VISUAL DE ALTERAÇÃO DE FRONT-END
   ═══════════════════════════════════════════════════════════════════════════

   O ciclo que estas tools fecham:

     git (o que mudou)
       → rotas afetadas (que páginas isso pode ter mexido)
         → servidor vivo (onde olhar)
           → login, se houver e com consentimento
             → print + texto da página + console
               → veredito: a alteração APARECE na tela?

   O último passo é o ponto da coisa. Um agente que abre a página e tira print
   provou que o servidor responde, não que a alteração foi feita. Por isso o
   plano extrai MARCADORES das linhas adicionadas no diff — texto visível que
   passou a existir — e o veredito é a presença desses marcadores no texto
   renderizado. Sem marcador extraível, o veredito é `inconclusive`, nunca
   `passed`: dizer "verificado" com base em um print que ninguém leu é
   exatamente a falha que estas tools existem para impedir.

   Nada aqui inicia servidor, roda migration ou escreve no banco do projeto.

   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  classifyChange,
  detectFrameworks,
  detectServers,
  mapRoutes,
} = require("./verify-project.js");

const {
  findLoginRoutes,
  discoverDeclaredCredentials,
  readDeclaredPassword,
  listDbUsers,
  rankForFeature,
} = require("./verify-auth.js");

const { isLocalTarget } = require("../../memory/verify-store.js");

/* ── git ───────────────────────────────────────────────────────────────── */

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root, encoding: "utf-8", timeout: 20000, windowsHide: true,
  });
}

/**
 * Arquivos alterados. Sem `base`, olha a árvore de trabalho (o que a sessão
 * mexeu e ainda não commitou), que é o caso de quem acabou de codar. Com
 * `base`, compara com o ramo de origem.
 */
function changedFiles(root, base) {
  const files = new Set();
  const collect = (out) => {
    for (const line of String(out).split("\n")) {
      const f = line.trim();
      if (f) files.add(f);
    }
  };

  if (base) {
    collect(git(root, ["diff", "--name-only", `${base}...HEAD`]));
  }
  // Working tree + staged, sempre: alteração não commitada é o alvo natural.
  collect(git(root, ["diff", "--name-only", "HEAD"]));
  collect(git(root, ["diff", "--name-only", "--cached"]));
  // Arquivo novo ainda não rastreado também é alteração de front-end.
  for (const line of git(root, ["status", "--porcelain"]).split("\n")) {
    if (line.startsWith("?? ")) files.add(line.slice(3).trim());
  }
  return [...files];
}

/**
 * Marcadores: texto humano que as linhas ADICIONADAS passaram a conter.
 *
 * Só serve o que pode aparecer na tela, então tudo que tem cara de código é
 * descartado — nome de classe CSS, identificador, caminho de import, chave de
 * objeto. O que sobra é frase.
 */
function extractMarkers(root, base, limit = 12) {
  const args = base
    ? ["diff", "-U0", `${base}...HEAD`]
    : ["diff", "-U0", "HEAD"];
  let diff;
  try { diff = git(root, args); } catch { return []; }

  const markers = [];
  const seen = new Set();

  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;

    // Valor de atributo de classe/estilo é removido ANTES da extração. A
    // tentativa anterior foi filtrar depois, por palavra-chave de framework
    // utilitário, e vazava em `gap-2` — o dígito derrubava o teste. Atacar na
    // origem é mais curto e não depende de conhecer o vocabulário do Tailwind.
    const added = line
      .slice(1)
      .replace(/(?:className|class|sx|style|tw)\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, " ")
      .replace(/(?:['"]?class(?:Name)?['"]?\s*[:=]>?\s*)(?:"[^"]*"|'[^']*')/g, " ");

    // Texto entre tags: <h1>Painel do motorista</h1>
    const between = [...added.matchAll(/>([^<>{}]{4,80})</g)].map((m) => m[1]);
    // Literal de string com espaço (frase, não identificador).
    const literals = [...added.matchAll(/['"]([^'"\\]{4,80})['"]/g)].map((m) => m[1]);

    for (const raw of [...between, ...literals]) {
      const text = raw.trim();
      if (text.length < 4 || text.length > 80) continue;
      if (!/\s/.test(text)) continue;                    // uma palavra só: provável identificador
      if (!/[a-zA-ZÀ-ÿ]/.test(text)) continue;           // precisa de letra
      if (/[{}<>$;=]|\/\/|=>|::/.test(text)) continue;   // sintaxe
      // Rede de segurança para classe que escapou da limpeza acima: dois ou
      // mais tokens com forma de utilitário (`items-center`, `gap-2`, `w-1/2`)
      // não são frase.
      const tokens = text.split(/\s+/);
      const utilityish = tokens.filter((t) => /^[a-z]+(?:[-:][a-z0-9./[\]%]+)+$/.test(t)).length;
      if (tokens.length > 1 && utilityish >= 2) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      markers.push(text);
      if (markers.length >= limit) return markers;
    }
  }
  return markers;
}

/* ── Evidência em disco ────────────────────────────────────────────────────
   O print tem de ser arquivo que o usuário abre. No modo CDP o screenshot
   volta como base64 e some se ninguém gravar; no modo webview volta como
   caminho. Os dois são normalizados para o diretório da execução.           */

function evidenceDir(workspace, runId) {
  const dir = path.join(workspace, ".codebrain", "verify", runId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function slugForRoute(route) {
  const slug = String(route).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || "root";
}

function createVerifyHandlers(opts = {}) {
  const browser = () => {
    if (!opts.browserHandlers) throw new Error("handlers de browser indisponíveis no bridge");
    return opts.browserHandlers;
  };
  const store = () => {
    if (!opts.memoryStore) throw new Error("MemoryStore não inicializado");
    return opts.memoryStore;
  };
  const ws = () => opts.getCurrentWorkspacePath?.() || process.cwd();

  /** Grava um print no diretório da execução, qualquer que seja o modo. */
  async function captureScreenshot(dir, label, fullPage, paneId) {
    const target = path.join(dir, `${label}.png`);
    const shot = await browser().browserScreenshot(fullPage, paneId);
    if (shot?.data) {
      fs.writeFileSync(target, Buffer.from(shot.data, "base64"));
      return { ok: true, path: target, mode: "cdp" };
    }
    if (shot?.path && fs.existsSync(shot.path)) {
      fs.copyFileSync(shot.path, target);
      return { ok: true, path: target, mode: "webview", original: shot.path };
    }
    return { ok: false, error: shot?.error || "screenshot não produziu imagem" };
  }

  return {
    /**
     * Monta o plano de verificação: o que mudou, onde olhar, o que procurar.
     * Não abre navegador — é a etapa de leitura.
     */
    async verifyPlan({ base, extra_ports, feature_context, session_id } = {}) {
      const root = ws();
      try {
        try { git(root, ["rev-parse", "--is-inside-work-tree"]); }
        catch { return { ok: false, error: `não é um repositório git: ${root}` }; }

        const files = changedFiles(root, base);
        if (files.length === 0) {
          return { ok: true, verdict: "nothing-to-verify", message: "nenhuma alteração encontrada na árvore de trabalho", files: [] };
        }

        const { frameworks, evidence: fwEvidence } = detectFrameworks(root);
        const mapped = mapRoutes({ root, files, frameworks });

        if (!mapped.anyFrontend) {
          return {
            ok: true,
            verdict: "nothing-to-verify",
            message: "as alterações são de backend ou irrelevantes para a interface; nenhuma página precisa ser aberta",
            frameworks,
            files: mapped.files,
          };
        }

        const servers = await detectServers(root, frameworks, extra_ports || []);
        const markers = extractMarkers(root, base);
        const loginRoutes = findLoginRoutes(root, frameworks);

        const plan = {
          root,
          frameworks,
          framework_evidence: fwEvidence,
          files: mapped.files,
          routes: mapped.routes,
          markers,
          servers,
          login_routes: loginRoutes,
          feature_context: feature_context || null,
        };

        const dir = evidenceDir(root, "pending");
        const created = store().verifyRunCreate({
          workspace: root,
          session_id,
          base_url: servers.live[0]?.baseUrl || null,
          plan,
          evidence_dir: dir,
        });

        return {
          ok: true,
          verdict: servers.live.length > 0 ? "ready" : "no-server",
          run_id: created.run_id,
          ...plan,
          next: servers.live.length === 0
            ? "nenhum servidor vivo nas portas candidatas — suba o servidor de desenvolvimento e rode verify_plan de novo"
            : markers.length === 0
              ? "sem marcador de texto extraível do diff: o veredito será inconclusive; confirme visualmente o print"
              : `rode verify_run com run_id=${created.run_id}`,
          warning: markers.length === 0
            ? "nenhuma frase nova foi extraída do diff (alteração pode ser só de estilo ou de lógica). A tool NÃO vai afirmar que a mudança apareceu."
            : undefined,
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /**
     * Quem pode logar e com qual papel. Não loga, não devolve senha — apenas
     * candidatos, ordenados pelo encaixe no contexto da feature, e a
     * procedência de cada credencial disponível.
     */
    async verifyAuthDiscover({ feature_context, allow_framework_cli = true, limit } = {}) {
      const root = ws();
      try {
        const { frameworks } = detectFrameworks(root);
        const loginRoutes = findLoginRoutes(root, frameworks);
        const declared = discoverDeclaredCredentials(root, frameworks);
        const db = listDbUsers({ root, frameworks, allowFrameworkCli: allow_framework_cli, limit });

        const ranked = db.ok ? rankForFeature({ users: db.users, featureContext: feature_context }) : [];

        // Cruza usuário do banco com credencial declarada no repositório: é o
        // cruzamento que decide se o login pode ser automático ou se o humano
        // precisa digitar.
        const candidates = ranked.map((entry) => {
          const match = declared.find((d) => d.identity.toLowerCase() === String(entry.identity).toLowerCase());
          return {
            identity: entry.identity,
            roles: entry.roles,
            fit_score: entry.score,
            why: entry.why,
            credentialAvailable: !!match,
            credential_source: match ? `${match.file}:${match.line}` : null,
            suggested_mode: match ? "seeder" : "manual",
          };
        });

        // Credencial declarada para alguém que o banco não listou ainda é útil.
        for (const d of declared) {
          if (candidates.some((c) => String(c.identity).toLowerCase() === d.identity.toLowerCase())) continue;
          candidates.push({
            identity: d.identity,
            roles: [],
            fit_score: 10,
            why: ["declarada em seeder; não confirmada no banco (rodou as migrations/seeders?)"],
            credentialAvailable: true,
            credential_source: `${d.file}:${d.line}`,
            suggested_mode: "seeder",
          });
        }

        return {
          ok: true,
          frameworks,
          login_routes: loginRoutes,
          db_read: { ok: db.ok, method: db.method || null, error: db.error || null, notes: db.notes || [] },
          candidates,
          policy: "Nenhuma senha é devolvida por esta tool, e nenhuma senha é adivinhada. Login só acontece com concessão aprovada: 'seeder' usa a credencial versionada no próprio repositório, 'manual' espera o usuário digitar no painel Browser.",
          next: candidates.length === 0
            ? "nenhum candidato: peça ao usuário um acesso de teste, ou use mode 'manual' e deixe-o logar no painel"
            : `peça autorização com verify_auth_request(identity="${candidates[0].identity}", mode="${candidates[0].suggested_mode}")`,
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /**
     * Pede autorização para logar. Cria uma concessão PENDENTE e mostra o
     * pedido ao usuário no pane. Nada é liberado aqui.
     */
    async verifyAuthRequest({ base_url, identity, role, mode = "manual", reason, credential_source, pane_id }) {
      const root = ws();
      try {
        let credential_file = null;
        let credential_line = null;
        if (String(mode) === "seeder") {
          // A procedência vem de verify_auth_discover; aqui ela é reconferida
          // no arquivo, para que uma referência inventada não passe.
          const parsed = String(credential_source || "").match(/^(.*):(\d+)$/);
          if (!parsed) {
            return { ok: false, error: "mode 'seeder' exige credential_source no formato 'arquivo:linha', como devolvido por verify_auth_discover" };
          }
          credential_file = parsed[1];
          credential_line = Number(parsed[2]);
          const check = readDeclaredPassword(root, identity, { file: credential_file, line: credential_line });
          if (!check) {
            return { ok: false, error: `nenhuma senha declarada em ${credential_source} — a referência não confere; rode verify_auth_discover outra vez` };
          }
        }

        const res = store().verifyGrantRequest({
          workspace: root, base_url, identity, role, mode, reason, credential_file, credential_line,
        });
        if (!res.ok) return res;

        // Torna o pedido visível onde o usuário está olhando.
        if (opts.questionHandlers?.questionAsk && pane_id) {
          try {
            await opts.questionHandlers.questionAsk({
              paneId: pane_id,
              question: `Autorizar login como "${identity}"${role ? ` (papel: ${role})` : ""} em ${base_url} para verificar a alteração de front-end?${reason ? ` Motivo: ${reason}` : ""}`,
              options: [`Aprovar (grant ${res.grant.id})`, "Recusar"],
              allowCustom: false,
            });
          } catch { /* a concessão pendente já é o registro; a pergunta é conveniência */ }
        }

        return res;
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async verifyAuthApprove({ grant_id, approved_by, ttl_seconds }) {
      try { return store().verifyGrantApprove({ grant_id, approved_by, ttl_seconds }); }
      catch (err) { return { ok: false, error: err.message }; }
    },

    async verifyAuthRevoke({ grant_id }) {
      try { return store().verifyGrantRevoke({ grant_id }); }
      catch (err) { return { ok: false, error: err.message }; }
    },

    async verifyAuthList({ include_expired } = {}) {
      try { return store().verifyGrantList({ workspace: ws(), include_expired }); }
      catch (err) { return { ok: false, error: err.message }; }
    },

    /**
     * Executa o login de uma concessão aprovada.
     *
     * Modo `seeder`: lê a senha do arquivo versionado e a digita. O valor não
     * entra no retorno, nem em log, nem em memória — vive o tempo de um
     * preenchimento de formulário.
     *
     * Modo `manual`: abre a tela de login e ESPERA o usuário autenticar no
     * painel Browser. É o caminho honesto quando não há credencial de
     * desenvolvimento: o agente pede acesso em vez de arrombar.
     */
    async verifyLogin({ grant_id, login_route, success_selector, success_url_pattern, timeout_ms = 120000, pane_id }) {
      const root = ws();
      try {
        const internal = store().verifyGrantInternal({ grant_id });
        if (!internal.ok) return internal;
        const grant = internal.row;

        if (!isLocalTarget(grant.base_url)) {
          return { ok: false, error: "alvo da concessão não é local; login recusado" };
        }

        const { frameworks } = detectFrameworks(root);
        const route = login_route || findLoginRoutes(root, frameworks)[0]?.route || "/login";
        const url = new URL(route, grant.base_url).toString();

        const nav = await browser().browserNavigate(url, pane_id);
        if (nav && nav.ok === false) return { ok: false, error: `navegação falhou: ${nav.error}`, url };

        if (grant.mode === "manual") {
          // Espera ativa pelo humano. O critério de sucesso é sair da tela de
          // login, não um timer: um sleep fixo declara sucesso sem prova.
          const deadline = Date.now() + Math.min(Number(timeout_ms) || 120000, 600000);
          let last = null;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 2000));
            const current = await browser().browserGetUrl(pane_id);
            last = current?.url || current?.result?.url || null;
            if (success_url_pattern && last && new RegExp(success_url_pattern).test(last)) {
              return { ok: true, mode: "manual", authenticated: true, url: last };
            }
            if (last && !last.includes(route.replace(/^\//, ""))) {
              return { ok: true, mode: "manual", authenticated: true, url: last, note: "saiu da tela de login" };
            }
          }
          return {
            ok: false, mode: "manual", authenticated: false, url: last,
            error: "tempo esgotado esperando o login manual",
            hint: "o painel Browser aceita mouse e teclado reais — o usuário pode autenticar ali e a verificação continua",
          };
        }

        // Modo seeder.
        const password = readDeclaredPassword(root, grant.identity, {
          file: grant.credential_file, line: grant.credential_line,
        });
        if (!password) {
          return { ok: false, error: `credencial declarada não mais legível em ${grant.credential_file}:${grant.credential_line}; peça uma concessão manual` };
        }

        const identityField = "input[type=email], input[name=email], input[name=username], input[name=login], #email, #username";
        const passwordField = "input[type=password], input[name=password], #password";

        const f1 = await browser().browserFill(identityField, grant.identity, true, pane_id);
        if (f1 && f1.ok === false) return { ok: false, error: `campo de identidade não encontrado: ${f1.error}`, url };
        const f2 = await browser().browserFill(passwordField, password, true, pane_id);
        if (f2 && f2.ok === false) return { ok: false, error: "campo de senha não encontrado", url };

        const submitted = await browser().browserClick("button[type=submit], input[type=submit]", pane_id);
        if (submitted && submitted.ok === false) {
          return { ok: false, error: `botão de envio não encontrado: ${submitted.error}`, url };
        }

        await browser().browserWaitForLoad(15000, pane_id).catch(() => {});
        const after = await browser().browserGetUrl(pane_id);
        const finalUrl = after?.url || after?.result?.url || null;

        let authenticated = !!finalUrl && !finalUrl.includes(route.replace(/^\//, ""));
        if (success_selector) {
          const found = await browser().browserWaitFor(success_selector, 8000, pane_id).catch(() => null);
          authenticated = !!(found && found.ok !== false);
        }
        if (success_url_pattern && finalUrl) {
          authenticated = new RegExp(success_url_pattern).test(finalUrl);
        }

        return {
          ok: true,
          mode: "seeder",
          authenticated,
          url: finalUrl,
          identity: grant.identity,
          credential_source: `${grant.credential_file}:${grant.credential_line}`,
          note: authenticated
            ? "autenticado; a senha usada veio do seeder versionado e não é devolvida por esta tool"
            : "o formulário foi enviado mas a tela de login não foi deixada — provável credencial de seeder desatualizada em relação ao banco",
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /**
     * Abre cada rota do plano, tira print, lê o texto e o console, e conclui
     * se os marcadores da alteração APARECEM na página.
     */
    async verifyRun({ run_id, routes, base_url, full_page = true, pane_id, settle_ms = 1200 }) {
      const root = ws();
      try {
        const runRes = store().verifyRunGet({ run_id });
        if (!runRes.data) return { ok: false, error: `execução ${run_id} não encontrada; rode verify_plan primeiro` };
        const plan = runRes.data.plan || {};

        const target = base_url || runRes.data.base_url || plan.servers?.live?.[0]?.baseUrl;
        if (!target) return { ok: false, error: "nenhuma URL base: o servidor de desenvolvimento não foi detectado" };
        if (!isLocalTarget(target)) {
          return { ok: false, error: `alvo não é local: ${target}. Esta verificação só roda contra loopback ou faixa privada.` };
        }

        const routeList = (routes && routes.length ? routes.map((r) => ({ route: r, confidence: "explicit" })) : plan.routes) || [];
        if (routeList.length === 0) return { ok: false, error: "nenhuma rota para verificar" };

        const markers = plan.markers || [];
        const dir = evidenceDir(root, run_id);
        const results = [];

        for (const entry of routeList) {
          const url = new URL(entry.route, target).toString();
          const result = { route: entry.route, url, confidence: entry.confidence };

          const nav = await browser().browserNavigate(url, pane_id);
          if (nav && nav.ok === false) {
            result.verdict = "unreachable";
            result.error = nav.error;
            results.push(result);
            continue;
          }
          await browser().browserWaitForLoad(15000, pane_id).catch(() => {});
          if (settle_ms > 0) await new Promise((r) => setTimeout(r, Math.min(settle_ms, 5000)));

          const shot = await captureScreenshot(dir, slugForRoute(entry.route), full_page, pane_id);
          result.screenshot = shot.ok ? shot.path : null;
          if (!shot.ok) result.screenshot_error = shot.error;

          const textRes = await browser().browserGetText(null, pane_id).catch(() => null);
          const pageText = String(textRes?.text ?? textRes?.result?.text ?? "");

          const consoleRes = await browser().browserConsoleLog("error", null, 20, pane_id).catch(() => null);
          const consoleErrors = (consoleRes?.entries || []).slice(0, 10);
          result.console_errors = consoleErrors.length;
          if (consoleErrors.length) result.console_sample = consoleErrors.slice(0, 3);

          // Tela de login no meio do caminho é informação, não falha: diz ao
          // agente que falta autenticar antes de concluir qualquer coisa.
          const looksLikeLogin = /log\s*in|entrar|senha|password/i.test(pageText.slice(0, 2000)) &&
            /password/i.test(pageText.slice(0, 2000));

          const found = markers.filter((m) => pageText.toLowerCase().includes(String(m).toLowerCase()));
          result.markers_expected = markers.length;
          result.markers_found = found.length;
          result.markers_missing = markers.filter((m) => !found.includes(m)).slice(0, 8);

          if (looksLikeLogin) {
            result.verdict = "auth-required";
            result.note = "a página pedida caiu numa tela de login; autentique com verify_login e rode de novo";
          } else if (markers.length === 0) {
            result.verdict = "inconclusive";
            result.note = "nenhum marcador de texto foi extraído do diff — o print precisa de olho humano ou de um marcador explícito";
          } else if (found.length === markers.length) {
            result.verdict = "passed";
          } else if (found.length > 0) {
            result.verdict = "partial";
          } else {
            result.verdict = "not-visible";
            result.note = "nenhuma frase adicionada no diff aparece nesta página — ou a rota está errada, ou o build não recarregou, ou a alteração não chegou à tela";
          }
          results.push(result);
        }

        const rank = { passed: 4, partial: 3, inconclusive: 2, "auth-required": 1, "not-visible": 0, unreachable: 0 };
        const worst = results.reduce((acc, r) => (rank[r.verdict] < rank[acc] ? r.verdict : acc), "passed");
        const summary = `${results.length} rota(s): ` +
          Object.entries(results.reduce((acc, r) => { acc[r.verdict] = (acc[r.verdict] || 0) + 1; return acc; }, {}))
            .map(([k, v]) => `${v} ${k}`).join(", ");

        store().verifyRunFinish({ run_id, verdict: worst, summary, results });

        return {
          ok: true,
          run_id,
          verdict: worst,
          summary,
          evidence_dir: dir,
          results,
          note: worst === "passed"
            ? "toda frase adicionada no diff aparece na tela"
            : "veredito abaixo de 'passed' — leia os prints antes de declarar a alteração verificada",
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /** Relatório de uma execução, ou a lista das últimas. */
    async verifyReport({ run_id, limit } = {}) {
      try {
        if (!run_id) return store().verifyRunList({ workspace: ws(), limit });
        const res = store().verifyRunGet({ run_id });
        if (!res.data) return { ok: false, error: `execução ${run_id} não encontrada` };
        const screenshots = (res.data.results || []).map((r) => r.screenshot).filter(Boolean);
        return { ok: true, ...res.data, screenshots };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  };
}

module.exports = { createVerifyHandlers, changedFiles, extractMarkers, slugForRoute };
