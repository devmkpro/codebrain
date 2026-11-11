"use strict";

/** Metadata-only access bridge. There is deliberately no secret read tool. */
function createAccessHandlers(opts = {}) {
  const unavailable = () => ({ ok: false, code: "VAULT_UNAVAILABLE", error: "Abra a Central → Acessos no aplicativo para configurar o cofre seguro." });
  async function invoke(method, input) {
    if (typeof opts[method] !== "function") return unavailable();
    try { return await opts[method](input); }
    catch { return { ok: false, code: "VAULT_OPERATION_FAILED", error: "Não foi possível concluir a operação segura de acesso." }; }
  }
  return {
    accessHostList: () => invoke("accessHostList"),
    accessHostSave: (input) => invoke("accessHostSave", input),
    accessSshOpen: (input) => invoke("accessSshOpen", input),
    accessSshTunnelOpen: (input) => invoke("accessSshTunnelOpen", input),
    accessAwsSsoLogin: (input) => invoke("accessAwsSsoLogin", input),
  };
}

module.exports = { createAccessHandlers };
