/** Public metadata only. No read/reveal operation exists for credential values. */
export type AccessCredentialKind = "api-key" | "password" | "ssh-key-path";
export type AccessSource = "user" | "agent";

export interface SsmTunnelConfig {
  instanceId: string;
  region: string;
  profile: string;
  localPort: number;
}

export interface AccessCredential {
  id: string;
  label: string;
  kind: AccessCredentialKind;
  allowAgentAccess: boolean;
  hasSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccessHost {
  id: string;
  label: string;
  hostname: string;
  port: number;
  username: string;
  credentialId: string | null;
  /** Explicit opt-in: hostname is an alias in the user's trusted SSH config. */
  useSshConfig?: boolean;
  ssmTunnel?: SsmTunnelConfig;
  allowAgentAccess: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccessCredentialInput {
  id?: string;
  label: string;
  kind: AccessCredentialKind;
  /** Write-only. Omit on update to preserve the saved value. */
  secret?: string;
  allowAgentAccess?: boolean;
}

export interface AccessHostInput {
  id?: string;
  label: string;
  hostname: string;
  port?: number;
  username: string;
  credentialId?: string | null;
  useSshConfig?: boolean;
  ssmTunnel?: SsmTunnelConfig | null;
  /** Only user-origin operations may supply this field. */
  allowAgentAccess?: boolean;
}

export interface AccessVaultStatus {
  available: boolean;
  backend: string | null;
  reason?: string;
}

export interface AccessVaultInventory {
  hosts: AccessHost[];
  credentials: AccessCredential[];
}

export type AccessVaultResult<T extends object = Record<never, never>> = {
  ok: boolean;
  error?: string;
  code?: string;
} & Partial<T>;

export interface AccessVaultBridge {
  status(): Promise<AccessVaultResult<{ status: AccessVaultStatus }>>;
  list(): Promise<AccessVaultResult<AccessVaultInventory>>;
  saveCredential(input: AccessCredentialInput): Promise<AccessVaultResult<{ credential: AccessCredential }>>;
  deleteCredential(input: { id: string; confirmed: true }): Promise<AccessVaultResult>;
  saveHost(input: AccessHostInput): Promise<AccessVaultResult<{ host: AccessHost }>>;
  deleteHost(input: { id: string; confirmed: true }): Promise<AccessVaultResult>;
  openSsh(input: { hostId: string }): Promise<AccessVaultResult<{ paneId: string; interactive: boolean }>>;
  loginSso(input: { profile: string }): Promise<AccessVaultResult>;
}
