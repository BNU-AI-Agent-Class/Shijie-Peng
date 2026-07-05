import { env } from "../config/env.js";
import { classifyPaper } from "./classifier.js";
import { localizePaper } from "./localizer.js";
import { appendUpdateLog, upsertPapers } from "../store/fileStore.js";
import { nowIso, parseDate, stableId } from "../lib/utils.js";
import { directions } from "../config/taxonomy.js";

const HCAI_TERMS = [
  '"human-ai interaction"',
  '"human-centered ai"',
  '"human-ai collaboration"',
  '"human-ai teaming"',
  '"trust in ai"',
  '"trust calibration"',
  '"explainable ai"',
  '"ai-assisted decision"',
  '"ai agents"',
  '"multi-agent collaboration"',
  '"large language model" "user study"',
  '"generative ai" "user study"',
  '"ai in education" "user study"',
  '"ai mental health" "user study"'
];

const DAILY_PAGE_LIMIT = 1;
const DEEP_PAGE_LIMIT = 3;
const DAILY_RESULTS_PER_PAGE = 100;
const DEEP_RESULTS_PER_PAGE = 50;
const DEFAULT_DEEP_MAX_CANDIDATES = 800;
const ARXIV_REQUEST_DELAY_MS = 3500;
const ARXIV_RATE_LIMIT_RETRY_MS = 20000;

const SOURCE_FETCHERS = {
  openalex: fetchOpenAlex,
  arxiv: fetchArxiv,
  crossref: fetchCrossref,
  semanticscholar: fetchSemanticScholar
};

export async function runUpdateJob(options = {}) {
  const startedAt = nowIso();
  const liveFetch = options.liveFetch ?? env.enableLiveFetch;
  const windowHours = options.windowHours ?? env.updateWindowHours;
  const source = options.source ?? "manual";
  const deep = Boolean(options.deep);
  const maxCandidates = options.maxCandidates ?? (deep ? DEFAULT_DEEP_MAX_CANDIDATES : Infinity);

  try {
    const { candidates, sourceResults } = liveFetch ? await fetchLiveCandidates(windowHours, { deep }) : { candidates: [], sourceResults: [] };
    const candidatesForStorage = mergeCandidates(candidates)
      .map(normalizeCandidate)
      .filter(Boolean)
      .filter((paper) => isInWindow(paper.sourceUpdatedAt ?? paper.publishedAt, windowHours))
      .slice(0, maxCandidates);
    const normalized = [];
    for (const paper of candidatesForStorage) normalized.push(await enrichPaper(paper));
    const result = normalized.length ? await upsertPapers(normalized) : { inserted: 0, updated: 0, total: undefined };
    const counts = countReviewStatus(normalized);

    return appendUpdateLog({
      id: `update_${Date.now()}`,
      startedAt,
      finishedAt: nowIso(),
      status: "completed",
      source,
      windowHours,
      deep,
      maxCandidates: Number.isFinite(maxCandidates) ? maxCandidates : undefined,
      fetched: candidates.length,
      inserted: result.inserted,
      updated: result.updated,
      approved: counts.approved,
      pendingReview: counts.pendingReview,
      excluded: counts.excluded,
      sourceResults,
      message: liveFetch
        ? `Fetched ${candidates.length} candidates from ${sourceResults.length} configured live sources${deep ? " with direction keyword pagination" : ""}.`
        : "Live fetch disabled; recorded scheduled heartbeat only."
    });
  } catch (error) {
    return appendUpdateLog({
      id: `update_${Date.now()}`,
      startedAt,
      finishedAt: nowIso(),
      status: "failed",
      source,
      windowHours,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function fetchLiveCandidates(windowHours = env.updateWindowHours, options = {}) {
  const activeSources = env.liveSources.filter((source) => SOURCE_FETCHERS[source]);
  const settled = await Promise.allSettled(activeSources.map((source) => SOURCE_FETCHERS[source](windowHours, options)));
  const sourceResults = settled.map((result, index) => {
    const source = activeSources[index];
    if (result.status === "fulfilled") return { source, status: "ok", fetched: result.value.length };
    return { source, status: "failed", fetched: 0, message: result.reason instanceof Error ? result.reason.message : String(result.reason) };
  });
  return {
    candidates: settled.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
    sourceResults
  };
}

async function fetchOpenAlex(windowHours, options = {}) {
  const from = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString().slice(0, 10);
  const groups = buildQueryGroups(options.deep);
  const pageLimit = options.deep ? DEEP_PAGE_LIMIT : DAILY_PAGE_LIMIT;
  const perPage = options.deep ? DEEP_RESULTS_PER_PAGE : DAILY_RESULTS_PER_PAGE;
  const papers = [];
  for (const group of groups) {
    for (let page = 1; page <= pageLimit; page += 1) {
      const url = new URL("https://api.openalex.org/works");
      url.searchParams.set("search", group.searchText);
      url.searchParams.set("filter", `from_publication_date:${from}`);
      url.searchParams.set("per-page", String(perPage));
      url.searchParams.set("page", String(page));
      url.searchParams.set("sort", "publication_date:desc");
      if (env.openAlexApiKey) url.searchParams.set("api_key", env.openAlexApiKey);
      if (env.openAlexEmail) url.searchParams.set("mailto", env.openAlexEmail);

      const response = await fetchWithTimeout(url);
      if (!response.ok) throw new Error(`OpenAlex fetch failed: ${response.status}`);
      const payload = await response.json();
      papers.push(...(payload.results ?? []).map((item) => ({
        source: "OpenAlex",
        sourceId: item.id,
        queryGroup: group.id,
        title: item.title,
        abstract: reconstructOpenAlexAbstract(item.abstract_inverted_index),
        authors: (item.authorships ?? []).map((authorship) => authorship.author?.display_name).filter(Boolean),
        institutions: [
          ...new Set(
            (item.authorships ?? [])
              .flatMap((authorship) => authorship.institutions ?? [])
              .map((institution) => institution.display_name)
              .filter(Boolean)
          )
        ],
        venue: item.primary_location?.source?.display_name ?? item.host_venue?.display_name ?? "",
        year: item.publication_year,
        publishedAt: item.publication_date,
        updatedAt: item.updated_date,
        citationCount: item.cited_by_count,
        doi: item.doi,
        url: item.doi ?? item.id
      })));
    }
  }
  return papers;
}

async function fetchArxiv(windowHours, options = {}) {
  const groups = buildQueryGroups(options.deep);
  const pageLimit = options.deep ? DEEP_PAGE_LIMIT : DAILY_PAGE_LIMIT;
  const perPage = options.deep ? DEEP_RESULTS_PER_PAGE : DAILY_RESULTS_PER_PAGE;
  const papers = [];
  let requestIndex = 0;
  for (const group of groups) {
    for (let page = 0; page < pageLimit; page += 1) {
      const url = new URL("https://export.arxiv.org/api/query");
      url.searchParams.set("search_query", group.arxivQuery);
      url.searchParams.set("start", String(page * perPage));
      url.searchParams.set("max_results", String(perPage));
      url.searchParams.set("sortBy", "submittedDate");
      url.searchParams.set("sortOrder", "descending");

      if (options.deep && requestIndex > 0) await sleep(ARXIV_REQUEST_DELAY_MS);
      requestIndex += 1;
      const response = await fetchArxivWithRetry(url);
      if (!response.ok) throw new Error(`arXiv fetch failed: ${response.status}`);
      const xml = await response.text();
      papers.push(...[...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
        const entry = match[1];
        return {
          source: "arXiv",
          sourceId: textOf(entry, "id"),
          queryGroup: group.id,
          title: cleanXmlText(textOf(entry, "title")),
          abstract: cleanXmlText(textOf(entry, "summary")),
          authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)].map((author) => cleanXmlText(author[1])),
          institutions: [],
          venue: "arXiv",
          year: Number.parseInt(textOf(entry, "published").slice(0, 4), 10),
          publishedAt: textOf(entry, "published"),
          updatedAt: textOf(entry, "updated"),
          url: textOf(entry, "id")
        };
      }));
    }
  }
  return papers;
}

async function fetchArxivWithRetry(url) {
  const response = await fetchWithTimeout(url);
  if (response.status !== 429) return response;
  await sleep(ARXIV_RATE_LIMIT_RETRY_MS);
  return fetchWithTimeout(url);
}

async function fetchCrossref(windowHours, options = {}) {
  const from = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString().slice(0, 10);
  const groups = buildQueryGroups(options.deep);
  const pageLimit = options.deep ? DEEP_PAGE_LIMIT : DAILY_PAGE_LIMIT;
  const perPage = options.deep ? DEEP_RESULTS_PER_PAGE : DAILY_RESULTS_PER_PAGE;
  const papers = [];
  for (const group of groups) {
    for (let page = 0; page < pageLimit; page += 1) {
      const url = new URL("https://api.crossref.org/works");
      url.searchParams.set("query.bibliographic", group.searchText);
      url.searchParams.set("filter", `from-pub-date:${from}`);
      url.searchParams.set("rows", String(perPage));
      url.searchParams.set("offset", String(page * perPage));
      url.searchParams.set("sort", "published");
      url.searchParams.set("order", "desc");
      if (env.crossrefEmail) url.searchParams.set("mailto", env.crossrefEmail);

      const response = await fetchWithTimeout(url);
      if (!response.ok) throw new Error(`Crossref fetch failed: ${response.status}`);
      const payload = await response.json();
      papers.push(...(payload.message?.items ?? []).map((item) => {
        const publishedAt = crossrefDate(item.published?.["date-parts"] ?? item["published-print"]?.["date-parts"] ?? item["published-online"]?.["date-parts"]);
        return {
          source: "Crossref",
          sourceId: item.DOI,
          queryGroup: group.id,
          title: Array.isArray(item.title) ? item.title[0] : item.title,
          abstract: stripTags(item.abstract ?? ""),
          authors: (item.author ?? []).map((author) => [author.given, author.family].filter(Boolean).join(" ")).filter(Boolean),
          institutions: [],
          venue: Array.isArray(item["container-title"]) ? item["container-title"][0] : "",
          year: publishedAt ? new Date(publishedAt).getUTCFullYear() : undefined,
          publishedAt,
          updatedAt: item.indexed?.["date-time"],
          citationCount: item["is-referenced-by-count"],
          doi: item.DOI ? `https://doi.org/${item.DOI}` : undefined,
          url: item.URL
        };
      }));
    }
  }
  return papers;
}

async function fetchSemanticScholar(windowHours, options = {}) {
  const groups = buildQueryGroups(options.deep).slice(0, options.deep ? 6 : 1);
  const perPage = options.deep ? 50 : 100;
  const papers = [];
  for (const group of groups) {
    const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
    url.searchParams.set("query", group.searchText);
    url.searchParams.set("limit", String(perPage));
    url.searchParams.set("fields", "title,abstract,authors,venue,year,publicationDate,url,externalIds,openAccessPdf,citationCount");
    const headers = env.semanticScholarApiKey ? { "x-api-key": env.semanticScholarApiKey } : {};

    const response = await fetchWithTimeout(url, { headers });
    if (!response.ok) throw new Error(`Semantic Scholar fetch failed: ${response.status}`);
    const payload = await response.json();
    papers.push(...(payload.data ?? []).map((item) => ({
      source: "Semantic Scholar",
      sourceId: item.paperId,
      queryGroup: group.id,
      title: item.title,
      abstract: item.abstract,
      authors: (item.authors ?? []).map((author) => author.name).filter(Boolean),
      institutions: [],
      venue: item.venue ?? "",
      year: item.year,
      publishedAt: item.publicationDate,
      updatedAt: item.publicationDate,
      citationCount: item.citationCount,
      doi: item.externalIds?.DOI ? `https://doi.org/${item.externalIds.DOI}` : undefined,
      url: item.url ?? item.openAccessPdf?.url
    })));
  }
  return papers.filter((paper) => isInWindow(paper.publishedAt, windowHours));
}

function buildQueryGroups(deep = false) {
  if (!deep) {
    const terms = HCAI_TERMS.map(cleanSearchTerm).filter(Boolean);
    return [{
      id: "hcai-core",
      searchText: terms.join(" "),
      arxivQuery: terms.map((term) => `all:"${escapeArxivTerm(term)}"`).join(" OR ")
    }];
  }

  const groups = directions.map((direction) => {
    const terms = [direction.name, ...(direction.aliases || [])]
      .map(cleanSearchTerm)
      .filter(isUsefulSearchTerm);
    const uniqueTerms = [...new Set(terms)].slice(0, 6);
    const searchText = uniqueTerms.join(" ");
    return {
      id: direction.id,
      searchText,
      arxivQuery: uniqueTerms.map((term) => `all:"${escapeArxivTerm(term)}"`).join(" OR ")
    };
  }).filter((group) => group.searchText && group.arxivQuery);

  const coreTerms = HCAI_TERMS.map(cleanSearchTerm).filter(Boolean);
  return [
    {
      id: "hcai-core",
      searchText: coreTerms.join(" "),
      arxivQuery: coreTerms.map((term) => `all:"${escapeArxivTerm(term)}"`).join(" OR ")
    },
    ...groups
  ];
}

function cleanSearchTerm(term) {
  return String(term || "")
    .replaceAll('"', "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulSearchTerm(term) {
  const value = cleanSearchTerm(term).toLowerCase();
  if (!value) return false;
  if (["hai", "hri", "xai", "ai", "llm"].includes(value)) return false;
  if (["fairness", "privacy", "safety", "empathy", "reliance", "accountability"].includes(value)) return false;
  return value.length >= 8 || value.includes(" ");
}

function escapeArxivTerm(term) {
  return cleanSearchTerm(term).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeCandidate(candidate) {
  const title = String(candidate.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return null;
  return {
    id: stableId("paper", candidate.doi ?? candidate.sourceId ?? title),
    title,
    abstract: String(candidate.abstract ?? "").replace(/\s+/g, " ").trim(),
    authors: candidate.authors ?? [],
    institutions: candidate.institutions ?? [],
    venue: candidate.venue ?? "",
    source: candidate.source ?? "Unknown",
    sourceId: candidate.sourceId,
    year: candidate.year ?? new Date(candidate.publishedAt ?? Date.now()).getUTCFullYear(),
    publishedAt: candidate.publishedAt ?? nowIso(),
    sourceUpdatedAt: candidate.updatedAt ?? candidate.publishedAt ?? nowIso(),
    doi: candidate.doi,
    url: candidate.url,
    citationCount: Number(candidate.citationCount ?? candidate.citation_count ?? candidate.citedByCount ?? 0) || 0,
    firstSeenAt: nowIso()
  };
}

export async function enrichPaper(paper) {
  const classification = classifyPaper(paper);
  return localizePaper({
    ...paper,
    ...classification,
    dataQuality: buildDataQuality(paper),
    updatedAt: nowIso()
  });
}

function countReviewStatus(papers) {
  return {
    approved: papers.filter((paper) => paper.reviewStatus === "auto_approved" || paper.reviewStatus === "approved").length,
    pendingReview: papers.filter((paper) => paper.reviewStatus === "pending_review").length,
    excluded: papers.filter((paper) => paper.reviewStatus === "excluded").length
  };
}

function buildDataQuality(paper) {
  let score = 40;
  if (paper.abstract) score += 25;
  if (paper.authors?.length) score += 10;
  if (paper.institutions?.length) score += 10;
  if (paper.publishedAt) score += 5;
  if (paper.doi || paper.url) score += 10;
  if (isFuturePublicationDate(paper.publishedAt)) score -= 25;
  const missingFields = ["abstract", "authors", "institutions", "publishedAt", "url"].filter((field) => {
    const value = paper[field];
    return Array.isArray(value) ? value.length === 0 : !value;
  });
  if (isFuturePublicationDate(paper.publishedAt)) missingFields.push("future_publication_date");
  return {
    score: Math.max(0, Math.min(score, 100)),
    missingFields
  };
}

function isFuturePublicationDate(value) {
  const date = parseDate(value);
  if (!date) return false;
  return date.getTime() > Date.now() + 24 * 60 * 60 * 1000;
}

function mergeCandidates(candidates) {
  const byKey = new Map();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (!key) continue;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, candidate);
      continue;
    }
    byKey.set(key, {
      ...current,
      ...candidate,
      abstract: longest(current.abstract, candidate.abstract),
      authors: mergeArrays(current.authors, candidate.authors),
      institutions: mergeArrays(current.institutions, candidate.institutions),
      source: mergeArrays([current.source], [candidate.source]).join("+"),
      url: current.url ?? candidate.url,
      doi: current.doi ?? candidate.doi
    });
  }
  return [...byKey.values()];
}

function candidateKey(candidate) {
  const doi = String(candidate.doi ?? "").toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").trim();
  if (doi) return `doi:${doi}`;
  const title = String(candidate.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return title ? `title:${title}` : "";
}

function isInWindow(value, windowHours) {
  const date = parseDate(value);
  if (!date) return true;
  return Date.now() - date.getTime() <= windowHours * 60 * 60 * 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function mergeArrays(a = [], b = []) {
  return [...new Set([...a, ...b].filter(Boolean))];
}

function longest(a = "", b = "") {
  return String(b ?? "").length > String(a ?? "").length ? b : a;
}

function crossrefDate(parts) {
  const first = parts?.[0];
  if (!first?.length) return undefined;
  const [year, month = 1, day = 1] = first;
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

function stripTags(value) {
  return String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function reconstructOpenAlexAbstract(index) {
  if (!index) return "";
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word;
  }
  return words.filter(Boolean).join(" ");
}

function textOf(xml, tag) {
  return xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim() ?? "";
}

function cleanXmlText(value) {
  return String(value)
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
