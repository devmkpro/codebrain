import * as fs from "node:fs";
import * as path from "node:path";

// Source runs from electron/main/services; bundled main code runs from
// out/main[/chunks]. Keep the prompts external so they can be edited without
// rebuilding the JS bundle, but resolve both layouts reliably.
const PROMPTS_DIRS = [
  path.join(__dirname, "../../../prompts"),
  // electron-vite bundle: out/main -> app root is ../../
  path.join(__dirname, "../../prompts"),
  path.join(__dirname, "../../../../prompts"),
  path.join(process.cwd(), "prompts"),
];

function loadPrompt(filename: string): string {
  for (const dir of PROMPTS_DIRS) {
    try {
      const file = path.join(dir, filename);
      if (fs.existsSync(file)) return fs.readFileSync(file, "utf-8").trim();
    } catch {
      // Try the next runtime layout.
    }
  }
  return "";
}

export const WORKER_PROMPT = loadPrompt("squad-worker.md");
export const ORCHESTRATOR_PROMPT = loadPrompt("squad-orchestrator.md");
export const UI_TESTER_PROMPT = loadPrompt("squad-ui-tester.md");
export const GEMINI_WORKER_PROMPT = loadPrompt("squad-worker-gemini.md");
export const CODEBRAIN_SYSTEM_PROMPT = loadPrompt("codebrain-system.md");
