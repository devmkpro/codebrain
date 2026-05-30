#!/usr/bin/env node
/**
 * Create a GitLab release and upload update files to the Package Registry.
 * Uses only Node.js built-in modules (no dependencies).
 */
import { readFileSync, readdirSync } from "fs";

const API_URL = process.env.CI_API_V4_URL;
const PROJECT_ID = process.env.CI_PROJECT_ID;
const PIPELINE_ID = process.env.CI_PIPELINE_ID;
const TAG = process.env.CI_COMMIT_TAG;
const PROJECT_URL = process.env.CI_PROJECT_URL;
const JOB_TOKEN = process.env.CI_JOB_TOKEN;

const PKG_REGISTRY = `${API_URL}/projects/${PROJECT_ID}/packages/generic/updates/latest`;

async function apiGet(path) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "JOB-TOKEN": JOB_TOKEN },
  });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json();
}

async function apiPost(path, data) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "JOB-TOKEN": JOB_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST ${path}: ${res.status} ${body}`);
  }
  return res.json();
}

async function apiPut(path, data) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PUT",
    headers: {
      "JOB-TOKEN": JOB_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PUT ${path}: ${res.status} ${body}`);
  }
  return res.json();
}

async function uploadToRegistry(fileName, filePath) {
  const content = readFileSync(filePath);
  const res = await fetch(`${PKG_REGISTRY}/${fileName}?override=true`, {
    method: "PUT",
    headers: {
      "JOB-TOKEN": JOB_TOKEN,
      "Content-Type": "application/octet-stream",
    },
    body: content,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload ${fileName}: ${res.status} ${body}`);
  }
  console.log(`Uploaded to registry: ${fileName}`);
}

// Find build job IDs
const jobs = await apiGet(
  `/projects/${PROJECT_ID}/pipelines/${PIPELINE_ID}/jobs?per_page=50`
);
const linuxJob = jobs.find((j) => j.name === "build_linux");
const windowsJob = jobs.find((j) => j.name === "build_windows");
const macosJob = jobs.find((j) => j.name === "build_macos");

if (!linuxJob || !windowsJob) {
  console.error("Could not find build jobs:", jobs.map((j) => j.name));
  process.exit(1);
}

console.log(`Linux job: ${linuxJob.id}, Windows job: ${windowsJob.id}${macosJob ? `, macOS job: ${macosJob.id}` : " (macOS not available)"}`);

// Upload update manifests and installers to Package Registry
const distFiles = readdirSync("dist");
const exeFile = distFiles.find((f) => f.endsWith("-win-x64.exe"));
const appImageFile = distFiles.find((f) => f.endsWith(".AppImage"));
const debFile = distFiles.find((f) => f.endsWith(".deb"));

if (!exeFile) throw new Error("Windows installer not found in dist/");
if (!appImageFile) throw new Error("AppImage not found in dist/");
if (!debFile) throw new Error("Deb package not found in dist/");

await uploadToRegistry("latest.yml", "dist/latest.yml");
await uploadToRegistry("latest-linux.yml", "dist/latest-linux.yml");
await uploadToRegistry(exeFile, `dist/${exeFile}`);
await uploadToRegistry(appImageFile, `dist/${appImageFile}`);
await uploadToRegistry(debFile, `dist/${debFile}`);

// macOS artifacts (optional — only if build_macos job ran)
const dmgFiles = distFiles.filter((f) => f.endsWith(".dmg"));
const macZipFiles = distFiles.filter((f) => f.includes("-mac") && f.endsWith(".zip"));
const latestMac = distFiles.find((f) => f === "latest-mac.yml");

for (const f of [...dmgFiles, ...macZipFiles]) {
  await uploadToRegistry(f, `dist/${f}`);
}
if (latestMac) await uploadToRegistry("latest-mac.yml", "dist/latest-mac.yml");

// Create GitLab release with download links pointing to Package Registry
const registryBase = `${PKG_REGISTRY}`;

const downloadLinks = [
  {
    name: "Windows x64 Setup",
    url: `${registryBase}/${exeFile}`,
    link_type: "package",
  },
  {
    name: "Linux x64 AppImage",
    url: `${registryBase}/${appImageFile}`,
    link_type: "package",
  },
  {
    name: "Linux x64 Deb",
    url: `${registryBase}/${debFile}`,
    link_type: "package",
  },
];

// Add macOS download links if available
for (const dmg of dmgFiles) {
  const arch = dmg.includes("arm64") ? "ARM64" : dmg.includes("x64") ? "x64" : "";
  downloadLinks.push({
    name: `macOS ${arch} DMG`.trim(),
    url: `${registryBase}/${dmg}`,
    link_type: "package",
  });
}

const release = {
  tag_name: TAG,
  name: `Release ${TAG}`,
  description: `## CodeBrain ${TAG}

### Downloads
- **Windows x64**: Setup exe
- **Linux x64**: AppImage
- **Linux x64**: Deb${dmgFiles.length > 0 ? "\n- **macOS**: DMG (x64 + ARM64)" : ""}

### Changes
- Native Gemini CLI + Codex CLI agent support
- Cross-platform CLI detection
- Bug fixes and improvements`,
  assets: {
    links: downloadLinks,
  },
};

let result;
try {
  result = await apiPost(`/projects/${PROJECT_ID}/releases`, release);
  console.log(`Release created: ${result.tag_name}`);
} catch (err) {
  if (err.message.includes("409")) {
    console.log("Release already exists, updating...");
    result = await apiPut(`/projects/${PROJECT_ID}/releases/${TAG}`, release);
    console.log(`Release updated: ${result.tag_name}`);
  } else {
    throw err;
  }
}
