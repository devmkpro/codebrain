"use strict";

/* Geração de imagem e vídeo. O arquivo sempre vai para
   <workspace>/assets/generated; `fetch` e credenciais são injetados para os
   testes não dependerem de rede nem de chave. */

const fs = require("node:fs");
const path = require("node:path");

const OUTPUT_SEGMENTS = ["assets", "generated"];
const REQUEST_TIMEOUT_MS = 120_000;
const VIDEO_POLL_MS = 5000;
const VIDEO_MAX_POLLS = 120;
const IMAGE_MODEL_OPENAI = "gpt-image-1";
const IMAGE_MODEL_GEMINI = "gemini-2.5-flash-image";
const IMAGE_MODEL_OPENROUTER = "google/gemini-2.5-flash-image";
const VIDEO_MODEL = "sora-2";

const PROVIDERS = [
  { id: "openai", label: "OpenAI", kinds: ["image", "video"], base: "https://api.openai.com/v1" },
  {
    id: "gemini",
    label: "Google Gemini",
    kinds: ["image"],
    base: "https://generativelanguage.googleapis.com/v1beta",
  },
  { id: "openrouter", label: "OpenRouter", kinds: ["image"], base: "https://openrouter.ai/api/v1" },
];

const EXTENSION_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
};
const KIND_BY_EXTENSION = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  mp4: "video",
  webm: "video",
};

function slugify(text) {
  const slug = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "midia";
}

const isInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

/** Cria a pasta de saída e recusa qualquer caminho, inclusive symlink, fora do workspace. */
function outputDir(workspace) {
  const root = fs.realpathSync(path.resolve(workspace));
  let dir = root;
  for (const segment of OUTPUT_SEGMENTS) {
    dir = path.join(dir, segment);
    // Validate each existing ancestor before creating anything under it.
    if (fs.existsSync(dir)) {
      dir = fs.realpathSync(dir);
      if (!isInside(root, dir)) throw new Error("pasta de saída fora do workspace");
    } else fs.mkdirSync(dir);
  }
  return dir;
}

function saveFile(dir, slug, stamp, extension, bytes) {
  for (let attempt = 0; ; attempt += 1) {
    const suffix = attempt ? `-${attempt}` : "";
    const file = path.join(dir, `${slug}-${stamp}${suffix}.${extension}`);
    try {
      fs.writeFileSync(file, bytes, { flag: "wx" });
      return file;
    } catch (err) {
      if (err.code !== "EEXIST" || attempt > 50) throw err;
    }
  }
}

function fromDataUrl(url) {
  const match = String(url ?? "").match(/^data:([^;,]+);base64,(.+)$/s);
  return match ? { mime: match[1], base64: match[2] } : null;
}

function createMediaHandlers(opts = {}) {
  const fetchFn = (...args) => (opts.fetchFn ?? fetch)(...args);
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? Date.now;
  const credentials = () => opts.getMediaCredentials?.() ?? {};
  const redact = (value) => {
    let text = String(value);
    for (const key of Object.values(credentials())) {
      if (typeof key?.apiKey === "string" && key.apiKey)
        text = text.split(key.apiKey).join("[redacted]");
    }
    return text;
  };
  const usableKey = (key) =>
    typeof key?.apiKey === "string" &&
    Boolean(key.apiKey.trim()) &&
    !/^\*+$/.test(key.apiKey.trim());

  const endpoint = (provider, key) => {
    const definition = PROVIDERS.find((candidate) => candidate.id === provider);
    return (key.baseUrl || definition.base).replace(/\/+$/, "");
  };

  async function request(url, init, what) {
    const response = await fetchFn(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...init,
    });
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body?.error?.message ? `: ${redact(body.error.message).slice(0, 200)}` : "";
      } catch {}
      throw new Error(`${what} respondeu HTTP ${response.status}${detail}`);
    }
    return response;
  }

  const generators = {
    async openaiImage(key, prompt, size) {
      const response = await request(
        `${endpoint("openai", key)}/images/generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.apiKey}` },
          body: JSON.stringify({
            model: IMAGE_MODEL_OPENAI,
            prompt,
            size: size || "1024x1024",
            n: 1,
          }),
        },
        "OpenAI"
      );
      const json = await response.json();
      const base64 = json?.data?.[0]?.b64_json;
      if (!base64) throw new Error("OpenAI não devolveu imagem");
      return { mime: "image/png", bytes: Buffer.from(base64, "base64"), model: IMAGE_MODEL_OPENAI };
    },

    async geminiImage(key, prompt) {
      const response = await request(
        `${endpoint("gemini", key)}/models/${IMAGE_MODEL_GEMINI}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key.apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ["IMAGE"] },
          }),
        },
        "Gemini"
      );
      const json = await response.json();
      const inline = (json?.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.inlineData ?? part.inline_data)
        .find(Boolean);
      if (!inline?.data) throw new Error("Gemini não devolveu imagem");
      return {
        mime: inline.mimeType ?? inline.mime_type ?? "image/png",
        bytes: Buffer.from(inline.data, "base64"),
        model: IMAGE_MODEL_GEMINI,
      };
    },

    async openrouterImage(key, prompt) {
      const response = await request(
        `${endpoint("openrouter", key)}/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.apiKey}` },
          body: JSON.stringify({
            model: IMAGE_MODEL_OPENROUTER,
            modalities: ["image", "text"],
            messages: [{ role: "user", content: prompt }],
          }),
        },
        "OpenRouter"
      );
      const json = await response.json();
      const data = fromDataUrl(json?.choices?.[0]?.message?.images?.[0]?.image_url?.url);
      if (!data) throw new Error("OpenRouter não devolveu imagem");
      return {
        mime: data.mime,
        bytes: Buffer.from(data.base64, "base64"),
        model: IMAGE_MODEL_OPENROUTER,
      };
    },

    async openaiVideo(key, prompt, size) {
      const base = endpoint("openai", key);
      const headers = { Authorization: `Bearer ${key.apiKey}` };
      const created = await (
        await request(
          `${base}/videos`,
          {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ model: VIDEO_MODEL, prompt, size: size || "1280x720" }),
          },
          "OpenAI"
        )
      ).json();
      if (!created?.id) throw new Error("OpenAI não devolveu o id do vídeo");

      let status = created.status;
      for (let poll = 0; status !== "completed"; poll += 1) {
        if (status === "failed")
          throw new Error(`geração do vídeo falhou: ${created.error?.message ?? "sem detalhe"}`);
        if (poll >= VIDEO_MAX_POLLS) throw new Error("vídeo não ficou pronto a tempo");
        await sleep(VIDEO_POLL_MS);
        const current = await (
          await request(`${base}/videos/${created.id}`, { headers }, "OpenAI")
        ).json();
        status = current?.status;
        if (status === "failed") created.error = current.error;
      }

      const content = await request(`${base}/videos/${created.id}/content`, { headers }, "OpenAI");
      return {
        mime: "video/mp4",
        bytes: Buffer.from(await content.arrayBuffer()),
        model: VIDEO_MODEL,
      };
    },
  };

  const providersFor = (kind) => {
    const keys = credentials();
    return PROVIDERS.filter(
      (provider) => provider.kinds.includes(kind) && usableKey(keys[provider.id])
    );
  };

  return {
    mediaProviders() {
      const keys = credentials();
      return {
        ok: true,
        providers: PROVIDERS.filter((provider) => usableKey(keys[provider.id])).map(
          ({ id, label, kinds }) => ({ id, label, kinds })
        ),
      };
    },

    async mediaGenerate({ kind = "image", prompt, provider, size, style, workspace } = {}) {
      try {
        if (kind !== "image" && kind !== "video")
          return { ok: false, error: "kind deve ser image ou video" };
        if (typeof prompt !== "string" || !prompt.trim())
          return { ok: false, error: "prompt obrigatório" };
        const root = workspace ?? opts.getCurrentWorkspacePath?.();
        if (!root) return { ok: false, error: "nenhum workspace aberto" };

        const available = providersFor(kind);
        const chosen = provider
          ? available.find((candidate) => candidate.id === provider)
          : available[0];
        if (!chosen) {
          return {
            ok: false,
            error: provider
              ? `provedor ${provider} sem chave ou sem suporte a ${kind}`
              : `nenhum provedor com chave para ${kind}; configure OpenAI, Gemini ou OpenRouter`,
          };
        }

        const fullPrompt = style?.trim() ? `${style.trim()}\n\n${prompt.trim()}` : prompt.trim();
        const dir = outputDir(root);
        const key = credentials()[chosen.id];
        const result = await generators[`${chosen.id}${kind === "image" ? "Image" : "Video"}`](
          key,
          fullPrompt,
          size
        );
        const extension = EXTENSION_BY_MIME[result.mime];
        if (!extension || !result.mime.startsWith(`${kind}/`) || !result.bytes.length)
          throw new Error("provedor devolveu mídia inválida");
        // Recheck after a long generation, before writing to disk.
        if (outputDir(root) !== dir) throw new Error("pasta de saída alterada durante geração");
        const file = saveFile(dir, slugify(prompt), now(), extension, result.bytes);
        return {
          ok: true,
          kind,
          provider: chosen.id,
          model: result.model,
          path: file,
          relativePath: path
            .relative(fs.realpathSync(path.resolve(root)), file)
            .replace(/\\/g, "/"),
          bytes: result.bytes.length,
        };
      } catch (err) {
        const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
        return {
          ok: false,
          error: timedOut ? "provedor não respondeu a tempo" : redact(err?.message ?? String(err)),
        };
      }
    },

    mediaList({ workspace } = {}) {
      const root = workspace ?? opts.getCurrentWorkspacePath?.();
      if (!root) return { ok: true, items: [] };
      const dir = path.join(path.resolve(root), ...OUTPUT_SEGMENTS);
      let names;
      try {
        if (!isInside(fs.realpathSync(path.resolve(root)), fs.realpathSync(dir)))
          return { ok: true, items: [] };
        names = fs.readdirSync(dir);
      } catch {
        return { ok: true, items: [] };
      }
      const items = names
        .map((name) => {
          const kind = KIND_BY_EXTENSION[path.extname(name).slice(1).toLowerCase()];
          if (!kind) return null;
          const file = path.join(dir, name);
          try {
            if (
              fs.lstatSync(file).isSymbolicLink() ||
              !isInside(fs.realpathSync(dir), fs.realpathSync(file))
            )
              return null;
            const stat = fs.statSync(file);
            return stat.isFile() ? { name, path: file, kind, createdAt: stat.mtimeMs } : null;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.createdAt - a.createdAt);
      return { ok: true, items };
    },
  };
}

module.exports = { createMediaHandlers, slugify };
