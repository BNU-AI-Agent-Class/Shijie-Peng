import { appendUpdateLog, upsertPapers } from "../src/backend/store/fileStore.js";
import { nowIso, stableId } from "../src/backend/lib/utils.js";
import { enrichPaper } from "../src/backend/services/updateJob.js";

const ids = process.argv.slice(2).map((id) => id.trim()).filter(Boolean);
if (!ids.length) {
  console.error("Usage: node scripts/ingest-arxiv-id.js 2601.11812 [2606.xxxxx]");
  process.exit(1);
}

const startedAt = nowIso();
const papers = [];

for (const id of ids) {
  const xml = await fetchArxivId(id);
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => match[1]);
  for (const entry of entries) papers.push(await enrichPaper(parseArxivEntry(entry)));
}

const result = papers.length ? await upsertPapers(papers) : { inserted: 0, updated: 0, total: undefined };
const counts = {
  approved: papers.filter((paper) => paper.reviewStatus === "auto_approved" || paper.reviewStatus === "approved").length,
  pendingReview: papers.filter((paper) => paper.reviewStatus === "pending_review").length,
  excluded: papers.filter((paper) => paper.reviewStatus === "excluded").length
};

const log = await appendUpdateLog({
  id: `ingest_arxiv_${Date.now()}`,
  startedAt,
  finishedAt: nowIso(),
  status: "completed",
  source: "arxiv-id",
  windowHours: 0,
  fetched: papers.length,
  inserted: result.inserted,
  updated: result.updated,
  ...counts,
  sourceResults: [{ source: "arxiv", status: "ok", fetched: papers.length }],
  message: `Ingested arXiv IDs: ${ids.join(", ")}.`
});

console.log(JSON.stringify({ log, papers: papers.map((paper) => ({ id: paper.id, title: paper.title, score: paper.hcaiScore, status: paper.reviewStatus, url: paper.url })) }, null, 2));

async function fetchArxivId(id) {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("id_list", id);
  const response = await fetch(url, {
    headers: { "User-Agent": "hcai-research-map/0.1" },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`arXiv fetch failed for ${id}: ${response.status}`);
  return response.text();
}

function parseArxivEntry(entry) {
  const sourceId = textOf(entry, "id");
  const title = cleanXmlText(textOf(entry, "title"));
  return {
    id: stableId("paper", sourceId || title),
    title,
    abstract: cleanXmlText(textOf(entry, "summary")),
    authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)].map((author) => cleanXmlText(author[1])),
    institutions: [],
    venue: "arXiv",
    source: "arXiv",
    sourceId,
    year: Number.parseInt(textOf(entry, "published").slice(0, 4), 10),
    publishedAt: textOf(entry, "published"),
    sourceUpdatedAt: textOf(entry, "updated"),
    url: sourceId,
    firstSeenAt: nowIso()
  };
}

function textOf(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function cleanXmlText(value) {
  return decodeXml(String(value)).replace(/\s+/g, " ").trim();
}

function decodeXml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
