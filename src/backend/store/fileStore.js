import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { nowIso } from "../lib/utils.js";

export function createEmptyDb() {
  return {
    meta: {
      version: 1,
      generatedAt: nowIso(),
      lastUpdateAt: null
    },
    papers: [],
    updateLogs: [],
    reviewDecisions: []
  };
}

export async function ensureDb(filePath = env.dataFile) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await writeDb(createEmptyDb(), filePath);
  }
}

export async function readDb(filePath = env.dataFile) {
  await ensureDb(filePath);
  const raw = await fs.readFile(filePath, "utf8");
  const db = JSON.parse(raw);
  return {
    ...createEmptyDb(),
    ...db,
    meta: { ...createEmptyDb().meta, ...(db.meta ?? {}) },
    papers: Array.isArray(db.papers) ? db.papers : [],
    updateLogs: Array.isArray(db.updateLogs) ? db.updateLogs : [],
    reviewDecisions: Array.isArray(db.reviewDecisions) ? db.reviewDecisions : []
  };
}

export async function writeDb(db, filePath = env.dataFile) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

export async function mutateDb(mutator, filePath = env.dataFile) {
  const db = await readDb(filePath);
  const result = await mutator(db);
  await writeDb(db, filePath);
  return result;
}

export async function upsertPapers(incomingPapers, filePath = env.dataFile) {
  return mutateDb((db) => {
    const existingById = new Map(db.papers.map((paper) => [paper.id, paper]));
    let inserted = 0;
    let updated = 0;

    for (const paper of incomingPapers) {
      const current = existingById.get(paper.id);
      if (current) {
        Object.assign(current, {
          ...paper,
          firstSeenAt: current.firstSeenAt ?? paper.firstSeenAt ?? nowIso(),
          updatedAt: paper.updatedAt ?? current.updatedAt ?? nowIso()
        });
        updated += 1;
      } else {
        db.papers.push({
          ...paper,
          firstSeenAt: paper.firstSeenAt ?? nowIso(),
          updatedAt: paper.updatedAt ?? nowIso()
        });
        inserted += 1;
      }
    }

    db.meta.lastUpdateAt = nowIso();
    return { inserted, updated, total: db.papers.length };
  }, filePath);
}

export async function appendUpdateLog(log, filePath = env.dataFile) {
  return mutateDb((db) => {
    const entry = {
      id: log.id,
      startedAt: log.startedAt ?? nowIso(),
      finishedAt: log.finishedAt ?? nowIso(),
      status: log.status ?? "completed",
      source: log.source ?? "manual",
      windowHours: log.windowHours,
      fetched: log.fetched ?? 0,
      inserted: log.inserted ?? 0,
      updated: log.updated ?? 0,
      approved: log.approved ?? 0,
      pendingReview: log.pendingReview ?? 0,
      excluded: log.excluded ?? 0,
      sourceResults: log.sourceResults ?? [],
      message: log.message ?? ""
    };
    db.updateLogs.unshift(entry);
    db.updateLogs = db.updateLogs.slice(0, 120);
    db.meta.lastUpdateAt = entry.finishedAt;
    return entry;
  }, filePath);
}

export async function updatePaper(id, patch, actor = "admin", filePath = env.dataFile) {
  return mutateDb((db) => {
    const paper = db.papers.find((item) => item.id === id);
    if (!paper) return null;

    const changedAt = nowIso();
    Object.assign(paper, patch, {
      updatedAt: changedAt,
      reviewedAt: changedAt,
      reviewedBy: actor
    });
    db.reviewDecisions.unshift({
      id: `review_${Date.now()}`,
      paperId: id,
      actor,
      changedAt,
      patch
    });
    db.reviewDecisions = db.reviewDecisions.slice(0, 300);
    return paper;
  }, filePath);
}
