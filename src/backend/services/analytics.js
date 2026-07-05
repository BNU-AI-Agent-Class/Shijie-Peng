import { directions } from "../config/taxonomy.js";
import { inLastDays, parseDate, summarizeList, unique } from "../lib/utils.js";

const directionById = new Map(directions.map((direction) => [direction.id, direction]));

export function getApprovedPapers(db) {
  return db.papers.filter((paper) => (paper.reviewStatus === "auto_approved" || paper.reviewStatus === "approved") && !isFuturePublicationDate(paper.publishedAt));
}

export function getReviewPapers(db) {
  return db.papers.filter((paper) => paper.reviewStatus === "pending_review");
}

export function buildDashboard(db) {
  const approved = getApprovedPapers(db);
  const pending = getReviewPapers(db);
  const recent = approved.filter((paper) => inLastDays(paper.firstSeenAt ?? paper.publishedAt, 7));
  const today = approved.filter((paper) => inLastDays(paper.firstSeenAt ?? paper.publishedAt, 1));
  const directionStats = buildDirectionSummaries(db, approved);

  return {
    generatedAt: new Date().toISOString(),
    lastUpdateAt: db.meta.lastUpdateAt,
    metrics: {
      totalPapers: approved.length,
      newToday: today.length,
      newLast7Days: recent.length,
      pendingReview: pending.length,
      activeDirections: directionStats.filter((item) => item.paperCount > 0).length,
      averageHcaiScore: average(approved.map((paper) => paper.hcaiScore))
    },
    todayPapers: summarizeList(sortPapers(today.length ? today : approved, "recent"), 8),
    hotDirections: summarizeList(directionStats, 8),
    emergingQuestions: summarizeList(buildQuestionStats(approved), 10),
    highScorePapers: summarizeList(sortPapers(approved, "score"), 6),
    updateLogs: summarizeList(db.updateLogs, 5)
  };
}

export function listPapers(db, query = {}) {
  const page = positiveInt(query.page, 1);
  const limit = Math.min(positiveInt(query.limit, 20), 100);
  let papers = filterPapers(db, query);

  papers = sortPapers(papers, query.sort ?? "recent");
  const total = papers.length;
  const start = (page - 1) * limit;

  return {
    items: papers.slice(start, start + limit),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  };
}

export function buildPaperFacets(db, query = {}) {
  const papers = filterPapers(db, {
    publishedWithinDays: query.publishedWithinDays,
    seenWithinDays: query.seenWithinDays,
    from: query.from,
    to: query.to,
    minScore: query.minScore,
    maxScore: query.maxScore,
    q: query.q,
    status: query.status
  });
  const directionCounts = new Map();
  for (const paper of papers) {
    for (const direction of [paper.primaryDirection, ...(paper.secondaryDirections ?? [])].filter(Boolean)) {
      directionCounts.set(direction, (directionCounts.get(direction) ?? 0) + 1);
    }
  }
  return {
    total: papers.length,
    generatedAt: new Date().toISOString(),
    directions: directions
      .map((direction) => ({
        id: direction.id,
        name: direction.name,
        nameZh: direction.nameZh,
        count: directionCounts.get(direction.id) ?? 0
      }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    questions: countValues(papers.flatMap((paper) => paper.researchQuestions ?? [])).slice(0, 12),
    methods: countValues(papers.flatMap((paper) => paper.researchMethods ?? [])).slice(0, 10),
    contexts: countValues(papers.flatMap((paper) => paper.applicationContexts ?? [])).slice(0, 10),
    userGroups: countValues(papers.flatMap((paper) => paper.userGroups ?? [])).slice(0, 10),
    aiTypes: countValues(papers.flatMap((paper) => paper.aiSystemTypes ?? [])).slice(0, 10),
    contributionTypes: countValues(papers.flatMap((paper) => paper.contributionTypes ?? [])).slice(0, 10),
    sources: countValues(papers.flatMap((paper) => String(paper.source || "").split("+"))).slice(0, 8)
  };
}

export function getPaper(db, id) {
  return db.papers.find((paper) => paper.id === id) ?? null;
}

export function listDirections(db) {
  return buildDirectionSummaries(db, getApprovedPapers(db));
}

export function getDirectionDetail(db, id) {
  const direction = directionById.get(id);
  if (!direction) return null;

  const papers = getApprovedPapers(db).filter((paper) => paperHasDirection(paper, id));
  const related = buildRelatedDirections(papers, id);

  return {
    ...direction,
    paperCount: papers.length,
    today: papers.filter((paper) => inLastDays(paper.firstSeenAt ?? paper.publishedAt, 1)).length,
    last7Days: papers.filter((paper) => inLastDays(paper.firstSeenAt ?? paper.publishedAt, 7)).length,
    last30Days: papers.filter((paper) => inLastDays(paper.firstSeenAt ?? paper.publishedAt, 30)).length,
    last365Days: papers.filter((paper) => inLastDays(paper.firstSeenAt ?? paper.publishedAt, 365)).length,
    averageHcaiScore: average(papers.map((paper) => paper.hcaiScore)),
    topQuestions: summarizeList(countValues(papers.flatMap((paper) => paper.researchQuestions ?? [])), 12),
    topMethods: summarizeList(countValues(papers.flatMap((paper) => paper.researchMethods ?? [])), 8),
    topContexts: summarizeList(countValues(papers.flatMap((paper) => paper.applicationContexts ?? [])), 8),
    representativePapers: summarizeList(sortPapers(papers, "score"), 10),
    recentPapers: summarizeList(sortPapers(papers, "recent"), 10),
    relatedDirections: related
  };
}

export function buildSearch(db, query) {
  const q = String(query ?? "").trim();
  if (!q) return { papers: [], directions: [], questions: [] };

  const approved = getApprovedPapers(db);
  const papers = summarizeList(sortPapers(approved.filter((paper) => matchesSearch(paper, q)), "score"), 10);
  const lower = q.toLowerCase();
  const matchingDirections = directions.filter((direction) => {
    return [direction.id, direction.name, direction.nameZh, direction.definition, ...(direction.aliases ?? [])]
      .join(" ")
      .toLowerCase()
      .includes(lower);
  });
  const questions = summarizeList(
    countValues(approved.flatMap((paper) => paper.researchQuestions ?? [])).filter((item) =>
      item.name.toLowerCase().includes(lower)
    ),
    10
  );

  return { papers, directions: matchingDirections, questions };
}

function buildDirectionSummaries(db, papers) {
  return directions
    .map((direction) => {
      const directionPapers = papers.filter((paper) => paperHasDirection(paper, direction.id));
      return {
        ...direction,
        paperCount: directionPapers.length,
        today: directionPapers.filter((paper) => inLastDays(paper.firstSeenAt ?? paper.publishedAt, 1)).length,
        last7Days: directionPapers.filter((paper) => inLastDays(paper.firstSeenAt ?? paper.publishedAt, 7)).length,
        last30Days: directionPapers.filter((paper) => inLastDays(paper.firstSeenAt ?? paper.publishedAt, 30)).length,
        last365Days: directionPapers.filter((paper) => inLastDays(paper.firstSeenAt ?? paper.publishedAt, 365)).length,
        averageHcaiScore: average(directionPapers.map((paper) => paper.hcaiScore)),
        topQuestions: summarizeList(countValues(directionPapers.flatMap((paper) => paper.researchQuestions ?? [])), 5),
        representativePaperIds: summarizeList(sortPapers(directionPapers, "score"), 3).map((paper) => paper.id)
      };
    })
    .sort((a, b) => b.last7Days - a.last7Days || b.paperCount - a.paperCount || b.averageHcaiScore - a.averageHcaiScore);
}

function buildQuestionStats(papers) {
  const recentPapers = papers.filter((paper) => inLastDays(paper.firstSeenAt ?? paper.publishedAt, 30));
  return countValues(recentPapers.flatMap((paper) => paper.researchQuestions ?? [])).map((item) => ({
    ...item,
    directionIds: unique(
      recentPapers
        .filter((paper) => hasValue(paper.researchQuestions, item.name))
        .flatMap((paper) => [paper.primaryDirection, ...(paper.secondaryDirections ?? [])])
    )
  }));
}

function buildRelatedDirections(papers, currentId) {
  const relatedIds = papers.flatMap((paper) => [paper.primaryDirection, ...(paper.secondaryDirections ?? [])]);
  return countValues(relatedIds)
    .filter((item) => item.name !== currentId)
    .map((item) => ({
      ...item,
      direction: directionById.get(item.name) ?? { id: item.name, name: item.name }
    }))
    .slice(0, 8);
}

function countValues(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function filterPapers(db, query = {}) {
  const status = query.status ?? "approved";
  let papers = status === "all" ? db.papers : status === "review" ? getReviewPapers(db) : getApprovedPapers(db);

  return papers.filter((paper) => {
    if (query.direction && !matchesAnyValue(query.direction, (value) => paperHasDirection(paper, value))) return false;
    if (query.question && !matchesAnyValue(query.question, (value) => hasValue(paper.researchQuestions, value))) return false;
    if (query.method && !matchesAnyValue(query.method, (value) => hasValue(paper.researchMethods, value))) return false;
    if (query.context && !matchesAnyValue(query.context, (value) => hasValue(paper.applicationContexts, value))) return false;
    if (query.userGroup && !matchesAnyValue(query.userGroup, (value) => hasValue(paper.userGroups, value))) return false;
    if (query.aiType && !matchesAnyValue(query.aiType, (value) => hasValue(paper.aiSystemTypes, value))) return false;
    if (query.contributionType && !matchesAnyValue(query.contributionType, (value) => hasValue(paper.contributionTypes, value))) return false;
    if (query.source && !matchesAnyValue(query.source, (value) => String(paper.source || "").split("+").some((source) => sameValue(source, value)))) return false;
    if (query.minScore && paper.hcaiScore < Number(query.minScore)) return false;
    if (query.maxScore && paper.hcaiScore > Number(query.maxScore)) return false;
    if (query.seenWithinDays && !inLastDays(paper.firstSeenAt ?? paper.publishedAt, Number(query.seenWithinDays))) return false;
    if (query.publishedWithinDays && !inLastDays(paper.publishedAt ?? paper.firstSeenAt, Number(query.publishedWithinDays))) return false;
    if (query.from && !dateAtOrAfter(paper.publishedAt ?? paper.firstSeenAt, query.from)) return false;
    if (query.to && !dateAtOrBefore(paper.publishedAt ?? paper.firstSeenAt, query.to)) return false;
    if (query.q && !matchesSearch(paper, query.q)) return false;
    return true;
  });
}

function matchesAnyValue(expected, predicate) {
  return splitParam(expected).some((value) => predicate(value));
}

function splitParam(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function sortPapers(papers, sort) {
  const items = [...papers];
  if (sort === "score") return items.sort((a, b) => (b.hcaiScore ?? 0) - (a.hcaiScore ?? 0));
  if (sort === "citations") return items.sort((a, b) => citationCount(b) - citationCount(a) || dateMs(b.firstSeenAt ?? b.publishedAt) - dateMs(a.firstSeenAt ?? a.publishedAt));
  if (sort === "institutions") return items.sort((a, b) => (b.institutions ?? []).length - (a.institutions ?? []).length || (b.hcaiScore ?? 0) - (a.hcaiScore ?? 0));
  if (sort === "title") return items.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  return items.sort((a, b) => dateMs(b.firstSeenAt ?? b.publishedAt) - dateMs(a.firstSeenAt ?? a.publishedAt));
}

function citationCount(paper) {
  return Number(paper.citationCount ?? paper.citation_count ?? paper.citedByCount ?? 0) || 0;
}

function paperHasDirection(paper, directionId) {
  return paper.primaryDirection === directionId || (paper.secondaryDirections ?? []).includes(directionId);
}

function hasValue(values, expected) {
  return (values ?? []).some((value) => sameValue(value, expected));
}

function sameValue(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function matchesSearch(paper, query) {
  const q = String(query).toLowerCase();
  return [
    paper.title,
    paper.abstract,
    paper.venue,
    paper.source,
    ...(paper.authors ?? []),
    ...(paper.institutions ?? []),
    ...(paper.researchQuestions ?? []),
    ...(paper.researchMethods ?? []),
    ...(paper.applicationContexts ?? [])
  ]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

function dateAtOrAfter(value, expected) {
  const date = parseDate(value);
  const threshold = parseDate(expected);
  return !date || !threshold ? true : date >= threshold;
}

function dateAtOrBefore(value, expected) {
  const date = parseDate(value);
  const threshold = parseDate(expected);
  return !date || !threshold ? true : date <= threshold;
}

function dateMs(value) {
  return parseDate(value)?.getTime() ?? 0;
}

function isFuturePublicationDate(value) {
  const date = parseDate(value);
  if (!date) return false;
  return date.getTime() > Date.now() + 24 * 60 * 60 * 1000;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
