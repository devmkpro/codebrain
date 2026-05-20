import * as path from "node:path";
import * as os from "node:os";

export const GLOBAL_DIR = path.join(os.homedir(), ".codebrain");
export const BROWSER_LOG_MAX = 2000;

export const BUILTIN_TEMPLATES = [
  {
    id: "mimo",
    label: "MIMO",
    icon: "MIMO",
    integrations: [
      {
        type: "mimo-compat",
        host: "openclaude",
        baseUrl: "https://token-plan-sgp.xiaomimimo.com/anthropic",
        tokenEnvVar: "MIMO_API_KEY",
        label: "MIMO",
        models: ["mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-pro", "mimo-v2-omni", "mimo-v2-flash"]
      }
    ]
  },
  {
    id: "gemini",
    label: "Google Gemini",
    icon: "G",
    signupUrl: "https://aistudio.google.com/app/apikey",
    integrations: [
      {
        type: "gemini-compat",
        host: "openclaude",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        tokenEnvVar: "GEMINI_API_KEY",
        label: "OpenClaude via Gemini API",
        models: ["gemini-3.1-pro", "gemini-3.5-flash", "gemini-3.1-flash-lite-preview", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"]
      }
    ]
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    icon: "OR",
    signupUrl: "https://openrouter.ai/keys",
    integrations: [
      {
        type: "openai-compat",
        host: "openclaude",
        baseUrl: "https://openrouter.ai/api/v1",
        tokenEnvVar: "OPENAI_API_KEY",
        label: "OpenClaude via OpenRouter",
        models: ["anthropic/claude-3.5-sonnet", "google/gemini-2.5-pro", "openai/gpt-4o"]
      }
    ]
  },
  {
    id: "anthropic",
    label: "Anthropic",
    icon: "A",
    signupUrl: "https://console.anthropic.com/settings/keys",
    integrations: [
      {
        type: "anthropic-compat",
        host: "openclaude",
        baseUrl: "https://api.anthropic.com",
        tokenEnvVar: "ANTHROPIC_AUTH_TOKEN",
        label: "OpenClaude Code",
        models: ["claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5-20251101", "claude-opus-4-1-20250805", "claude-opus-4-20250514", "claude-sonnet-4-6", "claude-sonnet-4-5-20250929", "claude-sonnet-4-20250514", "claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022", "claude-haiku-4-5-20251001", "claude-3-5-haiku-20241022"]
      }
    ]
  },
  {
    id: "openai",
    label: "OpenAI",
    icon: "O",
    signupUrl: "https://platform.openai.com/api-keys",
    integrations: [
      {
        type: "openai-compat",
        host: "openclaude",
        baseUrl: "https://api.openai.com/v1",
        tokenEnvVar: "OPENAI_API_KEY",
        label: "OpenClaude via OpenAI",
        models: ["gpt-5.5", "gpt-5.5-mini", "gpt-5.5-nano", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o3", "o4-mini", "o3-mini", "o1-pro", "o1"]
      }
    ]
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    icon: "DS",
    signupUrl: "https://platform.deepseek.com/api_keys",
    integrations: [
      {
        type: "openai-compat",
        host: "openclaude",
        baseUrl: "https://api.deepseek.com/v1",
        tokenEnvVar: "OPENAI_API_KEY",
        label: "OpenClaude via DeepSeek",
        models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-reasoner", "deepseek-chat"]
      }
    ]
  },
  {
    id: "mistral",
    label: "Mistral",
    icon: "M",
    signupUrl: "https://console.mistral.ai/api-keys",
    integrations: [
      {
        type: "openai-compat",
        host: "openclaude",
        baseUrl: "https://api.mistral.ai/v1",
        tokenEnvVar: "OPENAI_API_KEY",
        label: "OpenClaude via Mistral",
        models: ["mistral-large-latest", "mistral-small-latest", "devstral-latest", "codestral"]
      }
    ]
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    icon: "X",
    signupUrl: "https://console.x.ai/team/default/api-keys",
    integrations: [
      {
        type: "openai-compat",
        host: "openclaude",
        baseUrl: "https://api.x.ai/v1",
        tokenEnvVar: "OPENAI_API_KEY",
        label: "OpenClaude via Grok",
        models: ["grok-4.3", "grok-4", "grok-3"]
      }
    ]
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    icon: "🦙",
    integrations: [
      {
        type: "openai-compat",
        host: "openclaude",
        baseUrl: "http://localhost:11434/v1",
        tokenEnvVar: "OPENAI_API_KEY",
        label: "OpenClaude via Ollama",
        models: []
      }
    ]
  }
];
