// Offline TUI fixture. No providers, network, repository writes or credentials.
const ESC = "\x1b[";
let input = "";
let text = "";
let pasting = false;
let received = 0;

function draw(status) {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const line = (value) => value.replace(/[\r\n\x00-\x1f]/g, " ").slice(0, Math.max(1, cols - 1));
  process.stdout.write(`${ESC}H${ESC}2J[MK MODE] offline PTY regression\r\n`);
  process.stdout.write(`${line(status)}\r\n${line(text)}${ESC}${rows};1H`);
  process.stdout.write(line(`STATUS cols=${cols} rows=${rows} received=${received}`));
}

process.stdin.setRawMode?.(true);
process.stdin.setEncoding("utf8");
process.stdout.write(`${ESC}?2004h`);
draw("Paste or send a message; Enter submits; Ctrl+C exits.");
const statusDemo = process.argv.find((argument) => argument.startsWith("--status-demo"));
if (statusDemo) {
  text = "› Ask Codex to do anything";
  draw("Working (1m 35s • esc to interrupt)");
  setTimeout(() => draw("─ Worked for 6s ─"), Math.max(1, Number(statusDemo.split("=")[1]) || 6500));
}
process.stdout.on("resize", () => draw("Resized without losing TUI state."));
process.stdin.on("data", (data) => {
  input += data.toString();
  while (input.length) {
    if (input[0] === "\x1b" && input.length < 6) break;
    if (input.startsWith(`${ESC}200~`)) { pasting = true; input = input.slice(6); continue; }
    if (input.startsWith(`${ESC}201~`)) { pasting = false; input = input.slice(6); draw("Paste received; waiting for Enter."); continue; }
    const char = input[0];
    input = input.slice(1);
    if (char === "\x03") { process.stdout.write(`${ESC}?2004l${ESC}0m\r\n`); process.exit(0); }
    if (char === "\r" && !pasting) { received++; draw(`Submitted message ${received}.`); text = ""; }
    else text += char;
  }
});
process.stdin.resume();
