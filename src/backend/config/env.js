import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotEnv(path.join(rootDir, ".env"));

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (process.env[key]) continue;
    process.env[key] = rest.join("=").replace(/^["']|["']$/g, "");
  }
}

function readEnv(name, fallback) {
  return process.env[name] ?? fallback;
}

function readBool(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readInt(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

export const env = {
  rootDir,
  nodeEnv: readEnv("NODE_ENV", "development"),
  host: readEnv("HOST", "0.0.0.0"),
  port: readInt("PORT", 3000),
  publicBaseUrl: readEnv("PUBLIC_BASE_URL", "http://localhost:3000"),
  dataFile: path.resolve(rootDir, readEnv("DATA_FILE", "./data/db.json")),
  enableScheduler: readBool("ENABLE_SCHEDULER", true),
  enableLiveFetch: readBool("ENABLE_LIVE_FETCH", false),
  updateOnStart: readBool("UPDATE_ON_START", false),
  updateTimezone: readEnv("UPDATE_TIMEZONE", "Asia/Shanghai"),
  updateHour: readInt("UPDATE_HOUR", 0),
  updateWindowHours: readInt("UPDATE_WINDOW_HOURS", 72),
  liveSources: readEnv("LIVE_SOURCES", "openalex,arxiv,crossref,semanticscholar")
    .split(",")
    .map((source) => source.trim().toLowerCase())
    .filter(Boolean),
  adminApiToken: readEnv("ADMIN_API_TOKEN", "change-me"),
  openAlexApiKey: readEnv("OPENALEX_API_KEY", ""),
  openAlexEmail: readEnv("OPENALEX_EMAIL", ""),
  crossrefEmail: readEnv("CROSSREF_EMAIL", ""),
  semanticScholarApiKey: readEnv("SEMANTIC_SCHOLAR_API_KEY", "")
};
