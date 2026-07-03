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

export function registerAllIpcHandlers(ctx: AppContext): void {
  registerAppHandlers(ctx);
  registerPaneHandlers(ctx);
  registerWorkspaceHandlers(ctx);
  registerProviderHandlers(ctx);
  registerBrowserHandlers(ctx);
  registerAudioHandlers(ctx);
  registerSessionHandlers(ctx);
  registerCliHandlers(ctx);
  registerSkillHandlers(ctx);
  registerMiscHandlers(ctx);
  registerMemoryIpc(ctx);
  registerDiscordHandlers(ctx);
  registerOAuthHandlers(ctx);
  registerNotificationHandlers(ctx);
}
