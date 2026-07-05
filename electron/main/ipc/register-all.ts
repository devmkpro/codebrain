import type { AppContext } from "../context";
import { registerAppHandlers } from "./register-app";
import { registerPaneHandlers } from "./register-pane";
import { registerWorkspaceHandlers } from "./register-workspace";
import { registerProviderHandlers } from "./register-providers";
import { registerBrowserHandlers } from "./register-browser";
import { registerAudioHandlers } from "./register-audio";
import { registerSessionHandlers } from "./register-session";
import { registerCliHandlers } from "./register-cli";
import { registerSkillHandlers } from "./register-skill";
import { registerMiscHandlers } from "./register-misc";
import { registerMemoryIpc } from "./register-memory";
import { registerDiscordHandlers } from "./register-discord";
import { registerOAuthHandlers } from "./register-oauth";
import { registerNotificationHandlers } from "./register-notifications";
import { registerRecipeHandlers } from "./register-recipe";
import { registerRemoteBridgeHandlers } from "./register-remote-bridge";
import { registerCronHandlers } from "./register-cron";

export function registerAllIpcHandlers(ctx: AppContext): void {
  // Each group is isolated: a throw in one registration must not abort the
  // rest (previously a failure in an early group silently dropped every
  // handler registered after it — e.g. remote-bridge/cron).
  const groups: [string, (c: AppContext) => void][] = [
    ["app", registerAppHandlers],
    ["pane", registerPaneHandlers],
    ["workspace", registerWorkspaceHandlers],
    ["provider", registerProviderHandlers],
    ["browser", registerBrowserHandlers],
    ["audio", registerAudioHandlers],
    ["session", registerSessionHandlers],
    ["cli", registerCliHandlers],
    ["skill", registerSkillHandlers],
    ["misc", registerMiscHandlers],
    ["memory", registerMemoryIpc],
    ["discord", registerDiscordHandlers],
    ["oauth", registerOAuthHandlers],
    ["notification", registerNotificationHandlers],
    ["recipe", registerRecipeHandlers],
    ["remote-bridge", registerRemoteBridgeHandlers],
    ["cron", registerCronHandlers],
  ];
  for (const [name, fn] of groups) {
    try {
      fn(ctx);
    } catch (err) {
      console.error(`[ipc] FAILED to register "${name}" handlers:`, err);
    }
  }
}
