import { readDb, writeDb } from "../src/backend/store/fileStore.js";

const BAD_METHODS = new Set(["local_keyword_translation_fallback"]);

const db = await readDb();
let repaired = 0;

db.papers = db.papers.map((paper) => {
  const method = paper.localization?.zh?.method;
  if (!BAD_METHODS.has(method)) return paper;
  repaired += 1;
  return {
    ...paper,
    titleZh: paper.title || "",
    abstractZh: "",
    localization: {
      ...(paper.localization || {}),
      zh: {
        status: "translation_unavailable",
        method: "machine_translation_unavailable",
        generatedAt: new Date().toISOString(),
        sourceTitle: paper.title || "",
        sourceAbstractHash: hashText(paper.abstract || ""),
        note: "旧版关键词替换翻译已清除。机器翻译不可用时不展示半英半中的伪中文摘要，详情页仍保留原始摘要。"
      }
    }
  };
});

db.updateLogs.unshift({
  id: `repair_localization_${Date.now()}`,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  status: "completed",
  source: "maintenance",
  windowHours: 0,
  fetched: 0,
  inserted: 0,
  updated: repaired,
  approved: db.papers.filter((paper) => paper.reviewStatus === "auto_approved" || paper.reviewStatus === "approved").length,
  pendingReview: db.papers.filter((paper) => paper.reviewStatus === "pending_review").length,
  excluded: db.papers.filter((paper) => paper.reviewStatus === "excluded").length,
  sourceResults: [],
  message: `Repaired ${repaired} papers with obsolete keyword-fallback Chinese localization.`
});
db.updateLogs = db.updateLogs.slice(0, 120);
db.meta.lastUpdateAt = db.updateLogs[0].finishedAt;

await writeDb(db);

console.log(JSON.stringify({ repaired, total: db.papers.length }, null, 2));

function hashText(value) {
  let hash = 0;
  for (const char of String(value || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(16);
}
