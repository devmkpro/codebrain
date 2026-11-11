// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createAccessHandlers } from "./access-handlers.js";
import { createCodebrainMCPServer } from "../index.js";

describe("ferramentas SSH distribuídas com a skill", () => {
  it("estão registradas e habilitadas já na primeira sessão", async () => {
    const api = createAccessHandlers();
    const server = createCodebrainMCPServer(api);
    try {
      for (const name of ["access_host_list", "access_host_save", "access_ssh_open", "access_ssh_tunnel_open"]) {
        expect(server._registeredTools[name]?.enabled).toBe(true);
      }
      const response = await server._registeredTools.access_host_list.handler({}, {});
      expect(JSON.parse(response.content[0].text)).toMatchObject({ ok: false, code: "VAULT_UNAVAILABLE" });
      expect(response.isError).toBe(true);
    } finally { await server.close(); }
  });
  it("cadastro aceita só metadados e não possui método de revelar segredo", async () => {
    const accessHostSave = vi.fn(async (input) => ({ ok: true, host: input }));
    const api = createAccessHandlers({ accessHostSave });
    const server = createCodebrainMCPServer(api);
    try {
      const schema = server._registeredTools.access_host_save.inputSchema;
      const input = schema.parse({ label: "QA", hostname: "192.0.2.1", username: "qa", port: 22, useSshConfig: true,
        password: "must-not-reach-service", allowAgentAccess: true });
      await server._registeredTools.access_host_save.handler(input, {});
      expect(accessHostSave).toHaveBeenCalledWith({ label: "QA", hostname: "192.0.2.1", username: "qa", port: 22, useSshConfig: true });
      expect(Object.keys(api).some((key) => /secret|password|credential/i.test(key))).toBe(false);
    } finally { await server.close(); }
  });
  it("não serializa exceções nativas nem conteúdo de credenciais", async () => {
    const api = createAccessHandlers({ accessSshOpen: async () => { throw new Error("private-key-sensitive-content"); } });
    const result = await api.accessSshOpen({ hostId: "x" });
    expect(result).toMatchObject({ ok: false, code: "VAULT_OPERATION_FAILED" });
    expect(JSON.stringify(result)).not.toContain("private-key-sensitive-content");
  });
  it("encaminha parâmetros validados do túnel sem aceitar opções SSH arbitrárias", async () => {
    const accessSshTunnelOpen = vi.fn(async input => ({ ok: true, paneId: "tunnel-1", input }));
    const server = createCodebrainMCPServer(createAccessHandlers({ accessSshTunnelOpen }));
    try {
      const tool = server._registeredTools.access_ssh_tunnel_open;
      const input = tool.inputSchema.parse({ hostId: "de296b89-f75e-48ac-88ad-905899fdbfb7", direction: "local", listenPort: 11435, targetPort: 11434, sshOption: "bad" });
      await tool.handler(input, {});
      expect(accessSshTunnelOpen).toHaveBeenCalledWith({ hostId: input.hostId, direction: "local", listenPort: 11435, targetPort: 11434 });
      expect(() => tool.inputSchema.parse({ ...input, listenPort: 0 })).toThrow();
    } finally { await server.close(); }
  });
});
