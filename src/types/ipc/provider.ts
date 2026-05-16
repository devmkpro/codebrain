export interface Provider {
  id: string;
  label?: string;
  type?: string;
  host?: string;
  models?: string[];
  env?: Record<string, string>;
  baseUrl?: string;
  [key: string]: unknown;
}

export interface ProviderTemplate {
  id: string;
  label: string;
  icon: string;
  signupUrl?: string;
  integrations: ProviderIntegration[];
}

export interface ProviderIntegration {
  type: string;
  host: string;
  baseUrl: string;
  tokenEnvVar: string;
  label: string;
  models: string[];
}

export interface UpsertResult { ok: boolean; error?: string; }
export interface RemoveResult { ok: boolean; error?: string; }
