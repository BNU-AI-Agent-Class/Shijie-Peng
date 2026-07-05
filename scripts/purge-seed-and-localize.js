import { readDb, writeDb } from "../src/backend/store/fileStore.js";
import { enrichPaper } from "../src/backend/services/updateJob.js";

const db = await readDb();
const before = db.papers.length;
const beforeSeed = db.papers.filter((paper) => paper.source === "seed").length;

const realPapers = db.papers.filter((paper) => paper.source !== "seed");
const enriched = [];
for (const paper of realPapers) {
  const preserved = {
    firstSeenAt: paper.firstSeenAt,
    reviewedAt: paper.reviewedAt,
    reviewedBy: paper.reviewedBy,
    reviewNote: paper.reviewNote
  };
  enriched.push({
    ...(await enrichPaper(paper)),
    ...preserved,
    source: paper.source,
    sourceId: paper.sourceId
  });
}
db.papers = enriched;

db.updateLogs.unshift({
  id: `purge_seed_${Date.now()}`,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  status: "completed",
  source: "maintenance",
  windowHours: 0,
  fetched: 0,
  inserted: 0,
  updated: db.papers.length,
  approved: db.papers.filter((paper) => paper.reviewStatus === "auto_approved" || paper.reviewStatus === "approved").length,
  pendingReview: db.papers.filter((paper) => paper.reviewStatus === "pending_review").length,
  excluded: db.papers.filter((paper) => paper.reviewStatus === "excluded").length,
  sourceResults: [],
  message: `Removed ${beforeSeed} seed papers and generated Chinese title/summary fields for ${db.papers.length} real papers.`
});
db.updateLogs = db.updateLogs.slice(0, 120);
db.meta.lastUpdateAt = db.updateLogs[0].finishedAt;

await writeDb(db);

console.log(JSON.stringify({
  before,
  removedSeed: beforeSeed,
  after: db.papers.length,
  localized: db.papers.filter((paper) => paper.titleZh && paper.abstractZh).length
}, null, 2));
