import * as fs from "node:fs";
import * as path from "node:path";

const PROMPTS_DIR = path.join(__dirname, "../../prompts");

function loadPrompt(filename: string): string {
  try {
    return fs.readFileSync(path.join(PROMPTS_DIR, filename), "utf-8").trim();
  } catch {
    return "";
  }
}

export const WORKER_PROMPT = loadPrompt("squad-worker.md");
export const ORCHESTRATOR_PROMPT = loadPrompt("squad-orchestrator.md");
export const UI_TESTER_PROMPT = loadPrompt("squad-ui-tester.md");
export const GEMINI_WORKER_PROMPT = loadPrompt("squad-worker-gemini.md");
export const CODEBRAIN_SYSTEM_PROMPT = loadPrompt("codebrain-system.md");
