// @vitest-environment node

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMediaHandlers, slugify } from "./media-handlers.js";

const PNG_B64 = Buffer.from("imagem").toString("base64");
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

let workspace;
const key = (apiKey = "k") => ({ apiKey });

function handlers(fetchFn, keys = { openai: key() }) {
  return createMediaHandlers({
    fetchFn,
    getMediaCredentials: () => keys,
    getCurrentWorkspacePath: () => workspace,
    sleep: async () => {},
    now: () => 1000,
  });
}

beforeEach(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cb-media-")));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("mediaGenerate imagem", () => {
  it("OpenAI: salva em assets/generated com slug e timestamp", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ data: [{ b64_json: PNG_B64 }] }));
    const result = await handlers(fetchFn).mediaGenerate({ prompt: "Gato de Óculos!" });
    expect(result).toMatchObject({
      ok: true,
      provider: "openai",
      relativePath: "assets/generated/gato-de-oculos-1000.png",
    });
    expect(fs.readFileSync(result.path, "utf-8")).toBe("imagem");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect(JSON.parse(init.body)).toMatchObject({ model: "gpt-image-1", size: "1024x1024" });
  });

  it("Gemini: usa x-goog-api-key e lê inlineData", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        json({
          candidates: [
            {
              content: {
                parts: [{ text: "ok" }, { inlineData: { mimeType: "image/jpeg", data: PNG_B64 } }],
              },
            },
          ],
        })
      );
    const result = await handlers(fetchFn, { gemini: key("g") }).mediaGenerate({ prompt: "a" });
    expect(result.path.endsWith(".jpg")).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toContain("gemini-2.5-flash-image:generateContent");
    expect(fetchFn.mock.calls[0][1].headers["x-goog-api-key"]).toBe("g");
  });

  it("OpenRouter: lê a imagem da mensagem", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        json({
          choices: [
            { message: { images: [{ image_url: { url: `data:image/png;base64,${PNG_B64}` } }] } },
          ],
        })
      );
    const result = await handlers(fetchFn, { openrouter: key() }).mediaGenerate({ prompt: "a" });
    expect(result.ok).toBe(true);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).modalities).toContain("image");
  });

  it("escolhe o primeiro provedor com chave", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ data: [{ b64_json: PNG_B64 }] }));
    const result = await handlers(fetchFn, { openrouter: key(), openai: key() }).mediaGenerate({
      prompt: "a",
    });
    expect(result.provider).toBe("openai");
  });

  it("aplica o style antes do prompt", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ data: [{ b64_json: PNG_B64 }] }));
    await handlers(fetchFn).mediaGenerate({ prompt: "cena", style: "aquarela" });
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).prompt).toBe("aquarela\n\ncena");
  });

  it("não sobrescreve arquivo gerado no mesmo instante", async () => {
    const fetchFn = vi.fn().mockImplementation(async () => json({ data: [{ b64_json: PNG_B64 }] }));
    const api = handlers(fetchFn);
    const [a, b] = await Promise.all([
      api.mediaGenerate({ prompt: "a" }),
      api.mediaGenerate({ prompt: "a" }),
    ]);
    expect(a.path).not.toBe(b.path);
  });

  it("devolve erro legível sem expor a chave", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ error: { message: "cota" } }, 429));
    const result = await handlers(fetchFn, { openai: key("segredo") }).mediaGenerate({
      prompt: "a",
    });
    expect(result).toEqual({ ok: false, error: "OpenAI respondeu HTTP 429: cota" });
  });

  it("remove chave ecoada pelo provedor ou pelo transporte", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(json({ error: { message: "key secret rejected" } }, 401));
    expect(
      (await handlers(fetchFn, { openai: key("secret") }).mediaGenerate({ prompt: "a" })).error
    ).not.toContain("secret");
    fetchFn.mockRejectedValue(new Error("secret"));
    expect(
      (await handlers(fetchFn, { openai: key("secret") }).mediaGenerate({ prompt: "a" })).error
    ).not.toContain("secret");
  });

  it("recusa sem chave, sem prompt e kind inválido", async () => {
    const fetchFn = vi.fn();
    const api = handlers(fetchFn, {});
    expect((await api.mediaGenerate({ prompt: "a" })).ok).toBe(false);
    expect((await handlers(fetchFn).mediaGenerate({ prompt: " " })).ok).toBe(false);
    expect((await handlers(fetchFn).mediaGenerate({ prompt: "a", kind: "audio" })).ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("recusa pasta de saída que aponta para fora sem criar subpastas externas", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cb-outside-"));
    fs.symlinkSync(
      outside,
      path.join(workspace, "assets"),
      process.platform === "win32" ? "junction" : "dir"
    );
    const fetchFn = vi.fn();
    const result = await handlers(fetchFn).mediaGenerate({ prompt: "a" });
    expect(result.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(outside, "generated"))).toBe(false);
    expect(handlers(fetchFn).mediaList().items).toEqual([]);
    fs.unlinkSync(path.join(workspace, "assets"));
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

describe("mediaGenerate vídeo", () => {
  const download = {
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode("video").buffer,
  };

  it("cria, consulta até concluir e baixa", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ id: "v1", status: "queued" }))
      .mockResolvedValueOnce(json({ status: "in_progress" }))
      .mockResolvedValueOnce(json({ status: "completed" }))
      .mockResolvedValueOnce(download);
    const result = await handlers(fetchFn).mediaGenerate({ kind: "video", prompt: "voo" });
    expect(result.path.endsWith(".mp4")).toBe(true);
    expect(fs.readFileSync(result.path, "utf-8")).toBe("video");
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      "https://api.openai.com/v1/videos",
      "https://api.openai.com/v1/videos/v1",
      "https://api.openai.com/v1/videos/v1",
      "https://api.openai.com/v1/videos/v1/content",
    ]);
  });

  it("relata a falha da geração", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ id: "v1", status: "queued" }))
      .mockResolvedValueOnce(json({ status: "failed", error: { message: "bloqueado" } }));
    expect(await handlers(fetchFn).mediaGenerate({ kind: "video", prompt: "voo" })).toEqual({
      ok: false,
      error: "geração do vídeo falhou: bloqueado",
    });
  });

  it("Gemini não atende vídeo", async () => {
    const result = await handlers(vi.fn(), { gemini: key() }).mediaGenerate({
      kind: "video",
      prompt: "a",
    });
    expect(result.ok).toBe(false);
  });
});

describe("mediaList e mediaProviders", () => {
  it("ignora diretórios com extensão de mídia", () => {
    fs.mkdirSync(path.join(workspace, "assets", "generated", "folder.png"), { recursive: true });
    expect(handlers(vi.fn()).mediaList().items).toEqual([]);
    expect(handlers(vi.fn(), { openai: key(" **** ") }).mediaProviders().providers).toEqual([]);
  });
  it("lista só mídia, a mais nova primeiro", () => {
    const dir = path.join(workspace, "assets", "generated");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.png"), "x");
    fs.writeFileSync(path.join(dir, "b.mp4"), "x");
    fs.writeFileSync(path.join(dir, "c.txt"), "x");
    fs.utimesSync(path.join(dir, "a.png"), new Date(1000), new Date(1000));
    const { items } = handlers(vi.fn()).mediaList();
    expect(items.map((item) => [item.name, item.kind])).toEqual([
      ["b.mp4", "video"],
      ["a.png", "image"],
    ]);
  });

  it("lista vazia sem pasta", () => {
    expect(handlers(vi.fn()).mediaList()).toEqual({ ok: true, items: [] });
  });

  it("só anuncia provedor com chave, e nunca a chave", () => {
    const result = handlers(vi.fn(), { gemini: key("segredo") }).mediaProviders();
    expect(result.providers).toEqual([{ id: "gemini", label: "Google Gemini", kinds: ["image"] }]);
    expect(JSON.stringify(result)).not.toContain("segredo");
  });
});

describe("slugify", () => {
  it("nunca produz separador de caminho", () => {
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("!!!")).toBe("midia");
  });
});
