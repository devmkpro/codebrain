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
}
