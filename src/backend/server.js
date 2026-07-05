import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { env } from "./config/env.js";
import { directions, researchQuestionSeeds } from "./config/taxonomy.js";
import { nextDailyDelayMs } from "./lib/utils.js";
import { buildDashboard, buildPaperFacets, buildSearch, getDirectionDetail, getPaper, getReviewPapers, listDirections, listPapers } from "./services/analytics.js";
import { runUpdateJob } from "./services/updateJob.js";
import { ensureDb, readDb, updatePaper } from "./store/fileStore.js";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4"
};

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", env.publicBaseUrl);
      if (req.method === "OPTIONS") return sendJson(res, 204, {});
      if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
        return await routeApi(req, res, url);
      }
      return await serveStatic(req, res, url);
    } catch (error) {
      console.error(error);
      return sendJson(res, 500, { error: "internal_error", message: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function routeApi(req, res, url) {
  const db = await readDb();
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "hcai-research-map",
      time: new Date().toISOString(),
      papers: db.papers.length,
      lastUpdateAt: db.meta.lastUpdateAt,
      liveFetch: env.enableLiveFetch
    });
  }

  if (req.method === "GET" && pathname === "/api/meta") {
    return sendJson(res, 200, {
      name: "HCAI Research Map",
      version: "0.1.0",
      defaultLanguage: "zh",
      update: {
        timezone: env.updateTimezone,
        hour: env.updateHour,
        windowHours: env.updateWindowHours,
        liveFetch: env.enableLiveFetch,
        updateOnStart: env.updateOnStart,
        sources: env.liveSources
      },
      taxonomy: {
        directions,
        researchQuestions: researchQuestionSeeds
      },
      counts: {
        papers: db.papers.length,
        updateLogs: db.updateLogs.length
      }
    });
  }

  if (req.method === "GET" && pathname === "/api/dashboard") {
    return sendJson(res, 200, buildDashboard(db));
  }

  if (req.method === "GET" && pathname === "/api/papers") {
    return sendJson(res, 200, listPapers(db, Object.fromEntries(url.searchParams)));
  }

  if (req.method === "GET" && pathname === "/api/facets") {
    return sendJson(res, 200, buildPaperFacets(db, Object.fromEntries(url.searchParams)));
  }

  const paperMatch = pathname.match(/^\/api\/papers\/([^/]+)$/);
  if (req.method === "GET" && paperMatch) {
    const paper = getPaper(db, decodeURIComponent(paperMatch[1]));
    return paper ? sendJson(res, 200, paper) : sendJson(res, 404, { error: "paper_not_found" });
  }

  if (req.method === "GET" && pathname === "/api/directions") {
    return sendJson(res, 200, { items: listDirections(db) });
  }

  const directionMatch = pathname.match(/^\/api\/directions\/([^/]+)$/);
  if (req.method === "GET" && directionMatch) {
    const direction = getDirectionDetail(db, decodeURIComponent(directionMatch[1]));
    return direction ? sendJson(res, 200, direction) : sendJson(res, 404, { error: "direction_not_found" });
  }

  if (req.method === "GET" && pathname === "/api/review/papers") {
    if (!isAuthorized(req)) return sendJson(res, 401, { error: "unauthorized" });
    return sendJson(res, 200, { items: getReviewPapers(db) });
  }

  const reviewMatch = pathname.match(/^\/api\/review\/papers\/([^/]+)$/);
  if (req.method === "PATCH" && reviewMatch) {
    if (!isAuthorized(req)) return sendJson(res, 401, { error: "unauthorized" });
    const body = await readJsonBody(req);
    const updated = await updatePaper(decodeURIComponent(reviewMatch[1]), sanitizePaperPatch(body));
    return updated ? sendJson(res, 200, updated) : sendJson(res, 404, { error: "paper_not_found" });
  }

  if (req.method === "POST" && pathname === "/api/jobs/update") {
    if (!isAuthorized(req)) return sendJson(res, 401, { error: "unauthorized" });
    const body = await readJsonBody(req).catch(() => ({}));
    const log = await runUpdateJob({ source: "api", liveFetch: body.liveFetch, windowHours: body.windowHours });
    return sendJson(res, 200, log);
  }

  if (req.method === "GET" && pathname === "/api/update-logs") {
    return sendJson(res, 200, { items: db.updateLogs });
  }

  if (req.method === "GET" && pathname === "/api/search") {
    return sendJson(res, 200, buildSearch(db, url.searchParams.get("q")));
  }

  return sendJson(res, 404, { error: "not_found" });
}

async function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method_not_allowed" });

  const pathname = decodeURIComponent(url.pathname);
  const filePath = resolveStaticPath(pathname);
  if (!filePath) return sendJson(res, 404, { error: "not_found" });

  try {
    const data = await fs.readFile(filePath);
    const type = contentTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
    const shouldBypassCache = type.startsWith("text/html") || filePath.endsWith("hcai-live.js");
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": shouldBypassCache ? "no-store, no-cache, must-revalidate" : "public, max-age=3600"
    });
    if (req.method !== "HEAD") res.end(data);
    else res.end();
  } catch {
    sendJson(res, 404, { error: "not_found" });
  }
}

function resolveStaticPath(pathname) {
  if (pathname === "/" || pathname === "/zh") return path.join(env.rootDir, "hcai-radar-zh.html");
  if (pathname === "/en") return path.join(env.rootDir, "hcai-radar-en.html");
  if (pathname === "/hcai-radar-zh.html") return path.join(env.rootDir, "hcai-radar-zh.html");
  if (pathname === "/hcai-radar-en.html") return path.join(env.rootDir, "hcai-radar-en.html");
  if (pathname.startsWith("/public/")) return safeJoin(env.rootDir, pathname.slice(1));
  return null;
}

function safeJoin(root, relativePath) {
  const target = path.resolve(root, relativePath);
  return target.startsWith(root) ? target : null;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS"
  });
  if (status === 204) return res.end();
  return res.end(JSON.stringify(payload, null, 2));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function isAuthorized(req) {
  if (env.nodeEnv === "development" && env.adminApiToken === "change-me") return true;
  return req.headers.authorization === `Bearer ${env.adminApiToken}`;
}

function sanitizePaperPatch(body) {
  const allowed = [
    "reviewStatus",
    "hcaiScore",
    "primaryDirection",
    "secondaryDirections",
    "researchQuestions",
    "researchMethods",
    "applicationContexts",
    "userGroups",
    "aiSystemTypes",
    "interactionModes",
    "evaluationMetrics",
    "contributionTypes",
    "classificationReason",
    "reviewNote"
  ];
  return Object.fromEntries(Object.entries(body ?? {}).filter(([key]) => allowed.includes(key)));
}

export function startScheduler() {
  if (!env.enableScheduler) return;

  const scheduleNext = () => {
    const delay = nextDailyDelayMs(env.updateTimezone, env.updateHour);
    setTimeout(async () => {
      await runUpdateJob({ source: "scheduler" });
      scheduleNext();
    }, delay).unref();
  };

  scheduleNext();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validateProductionConfig();
  await ensureDb();
  const server = createServer();
  server.listen(env.port, env.host, () => {
    console.log(`HCAI Research Map listening on http://${env.host}:${env.port}`);
  });
  startScheduler();
  void runStartupUpdate();
}

function validateProductionConfig() {
  if (env.nodeEnv === "production" && env.adminApiToken === "change-me") {
    throw new Error("ADMIN_API_TOKEN must be set to a strong secret in production.");
  }
}

async function runStartupUpdate() {
  if (!env.enableLiveFetch) return;
  const db = await readDb();
  if (!env.updateOnStart && db.papers.length > 0) return;
  const log = await runUpdateJob({ source: "startup" });
  console.log(`Startup update ${log.status}: fetched ${log.fetched}, inserted ${log.inserted}, updated ${log.updated}`);
}
