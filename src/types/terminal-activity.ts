/** Shared, dependency-free interpretation of terminal activity for main and renderer. */
export interface TerminalActivitySnapshot {
  text: string;
  active: "thinking" | "running" | null;
  activeAt: number;
  completedAt: number;
}

/**
 * A bounded status projection, not a replacement terminal emulator. Interpret
 * the cursor/erase sequences used by inline TUIs so erased spinners do not stay
 * "working" forever just because their bytes remain in scrollback history.
 */
export function terminalStatusText(raw: string): string {
  const text = raw.slice(-8192).replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
  const lines: string[][] = [[]];
  let x = 0;
  let y = 0;
  const line = () => lines[y] ||= [];
  const eraseLine = (mode: number) => {
    if (mode === 2) lines[y] = [];
    else if (mode === 1) line().fill(" ", 0, x + 1);
    else line().splice(x);
  };
  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (char === "\x1b") {
      const sequence = /^\x1b\[([0-?]*)(?:[ -/]*)([@-~])/.exec(text.slice(index));
      if (!sequence) { index += 2; continue; }
      index += sequence[0].length;
      if (sequence[1].startsWith("?")) continue;
      const params = sequence[1].split(";").map((value) => Number(value) || 0);
      const amount = params[0] || 1;
      switch (sequence[2]) {
        case "A": y = Math.max(0, y - amount); break;
        case "B": y = Math.min(200, y + amount); break;
        case "C": x = Math.min(1024, x + amount); break;
        case "D": x = Math.max(0, x - amount); break;
        case "E": y = Math.min(200, y + amount); x = 0; break;
        case "F": y = Math.max(0, y - amount); x = 0; break;
        case "G": x = Math.min(1024, amount - 1); break;
        case "H": case "f":
          y = Math.min(200, amount - 1);
          x = Math.min(1024, (params[1] || 1) - 1);
          break;
        case "K": eraseLine(params[0]); break;
        case "J":
          if (params[0] === 2 || params[0] === 3) lines.length = 0;
          else if (params[0] === 1) { for (let row = 0; row < y; row++) lines[row] = []; eraseLine(1); }
          else { lines.splice(y + 1); eraseLine(0); }
          break;
      }
      continue;
    }
    index++;
    if (char === "\r") { x = 0; continue; }
    if (char === "\n") {
      y++;
      if (y > 200) { lines.shift(); y = 200; }
      continue;
    }
    if (char === "\b") { x = Math.max(0, x - 1); continue; }
    if (char === "\t") { x = Math.min(1024, x + 8 - x % 8); continue; }
    if (char < " " || char === "\x7f") continue;
    const current = line();
    while (current.length < x) current.push(" ");
    current[x] = char;
    x = Math.min(1024, x + 1);
  }
  return Array.from(lines, (row) => row?.join("").trimEnd() || "").join("\n");
}

function lastIndex(pattern: RegExp, text: string): number {
  let last = -1;
  for (const match of text.matchAll(pattern)) last = match.index ?? last;
  return last;
}

export interface KiroInputSnapshot {
  kind: "ready" | "initializing" | "working" | "running" | "blocked";
  at: number;
  prompt: string;
}

/**
 * Input literals from installed Kiro 3.1 tui.js RZ() (:1280), used by both
 * TUI and lite. Read projected visible text, NOT arbitrary raw ANSI history.
 * Footer allowlisting is intentional: a response/loading screen after an old
 * input must never turn that historical placeholder into readiness evidence.
 */
export function readKiroInput(text: string): KiroInputSnapshot | null {
  const visible = text.trimEnd();
  const lines = visible.split("\n");
  let at = visible.length;
  for (let row = lines.length - 1; row >= 0; row--) {
    const line = lines[row];
    at -= line.length;
    const match = /^\s*(?:(?:\[[^\]\n]{1,80}\]|kiro(?:-cli)?)\s*)?[>❯›]\s*(.*)$/.exec(line);
    if (match) {
      const body = match[1].trim();
      const result = (kind: KiroInputSnapshot["kind"]): KiroInputSnapshot => ({ kind, at, prompt: line.trim() });
      // A quoted code sample is not the interactive input surface.
      const fences = lines.slice(0, row).filter((value) => /^\s*(?:```|~~~)/.test(value)).length;
      if (fences % 2) return result("blocked");
      if (/^Initializing\s+[·•.]\s+type to queue (?:a|another) message$/i.test(body)) return result("initializing");
      if (/^Kiro is working(?:\s+[·•.]\s+.*)?$/i.test(body)) return result("working");
      if (/^Goal Active:/.test(body)) return result("running");
      const ready = body === "" || /^ask a question,? or describe a task(?:\s+(?:↵|enter))?(?:\s+[·•.]\s+(?:exit plan mode:\s*shift\+tab|\/tangent to go back\s+[·•.]\s+\/tangent ls to view))?$/i.test(body);
      if (!ready) return result("blocked");
      const footers = lines.slice(row + 1).map((value) => value.trim()).filter(Boolean);
      const knownFooter = (value: string) =>
        /^[─━⎯│└┘┌┐┬┴┼\s]+$/.test(value) ||
        /^(?:\/sessions to resume\s+[·•.]\s+)?\/copy to clipboard$/i.test(value) ||
        /^Showing detailed output\s+[·•.]\s+ctrl\+o to toggle$/i.test(value) ||
        /^press ctrl\+o to expand$/i.test(value) ||
        /^(?:agent|model|context|effort|tokens|session credits|credits|location|branch|background tasks)\s*[:·•]/i.test(value);
      return result(footers.length <= 8 && footers.every(knownFooter) ? "ready" : "blocked");
    }
    at--;
  }
  return null;
}

export function readTerminalActivity(raw: string): TerminalActivitySnapshot {
  const text = terminalStatusText(raw).slice(-1800);
  const kiro = readKiroInput(text);
  const kiroActiveAt = kiro && ["initializing", "working", "running"].includes(kiro.kind) ? kiro.at : -1;
  const interruptAt = lastIndex(/\besc\s+to\s+(?:interrupt|cancel)\b/gi, text);
  const spinnerAt = lastIndex(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✻✽✶✢✳]\s*(?:working|thinking|pondering|planning|processing|generating)\b/gi, text);
  let progressAt = -1;
  let progressCompletedAt = -1;
  for (const match of text.matchAll(/\b(?:Downloading|Installing|Processing|Generating|Building|Running|Executing)\b[^\n]{0,100}?\b(\d{1,3})%/gi)) {
    if (Number(match[1]) < 100) progressAt = match.index ?? progressAt;
    else progressCompletedAt = match.index ?? progressCompletedAt;
  }
  const activeAt = Math.max(interruptAt, spinnerAt, progressAt, kiroActiveAt);
  const completedAt = Math.max(progressCompletedAt, lastIndex(/(?:^|\n)\s*(?:[─━⎯—-]+\s*)?(?:Worked for\s+\d|(?:Turn|Task)\s+(?:completed|finished)|Interrupted\b|(?:Operation|Task)\s+cancell?ed\b)/gi, text));
  const active = activeAt < 0 || completedAt > activeAt ? null
    : progressAt === activeAt || (kiroActiveAt === activeAt && kiro?.kind !== "working") || /\b(?:Running|Executing)\b/.test(text.slice(Math.max(0, activeAt - 100), activeAt + 100)) ? "running" : "thinking";
  return { text, active, activeAt, completedAt };
}
