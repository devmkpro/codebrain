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

if (!linuxJob || !windowsJob) {
  console.error("Could not find build jobs:", jobs.map((j) => j.name));
  process.exit(1);
}

console.log(`Linux job: ${linuxJob.id}, Windows job: ${windowsJob.id}`);

// Upload update manifests and installers to Package Registry
const exeFile = readdirSync("dist").find((f) => f.endsWith("-win-x64.exe"));
const appImageFile = readdirSync("dist").find((f) => f.endsWith(".AppImage"));

if (!exeFile) throw new Error("Windows installer not found in dist/");
if (!appImageFile) throw new Error("AppImage not found in dist/");

await uploadToRegistry("latest.yml", "dist/latest.yml");
await uploadToRegistry("latest-linux.yml", "dist/latest-linux.yml");
await uploadToRegistry(exeFile, `dist/${exeFile}`);
await uploadToRegistry(appImageFile, `dist/${appImageFile}`);

// Create GitLab release with download links pointing to Package Registry
const registryBase = `${PKG_REGISTRY}`;

const release = {
  tag_name: TAG,
  name: `Release ${TAG}`,
  description: `## CodeBrain ${TAG}

### Downloads
- **Windows x64**: Setup exe
- **Linux x64**: AppImage
- **Linux x64**: Deb

### Changes
- Model validation for squad spawning
- Bug fixes and improvements`,
  assets: {
    links: [
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
        url: `${PROJECT_URL}/-/jobs/${linuxJob.id}/artifacts/raw/dist/Codebrain-${TAG}-linux-amd64.deb`,
        link_type: "package",
      },
    ],
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
