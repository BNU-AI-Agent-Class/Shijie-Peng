import assert from "node:assert/strict";
import test from "node:test";
import { classifyPaper } from "../src/backend/services/classifier.js";
import { buildDashboard, getDirectionDetail, listPapers } from "../src/backend/services/analytics.js";
import { enrichPaper } from "../src/backend/services/updateJob.js";

function paperInput(overrides = {}) {
  return {
    id: "paper_test",
    title: "Trust Calibration in Human-AI Decision Support",
    abstract:
      "A controlled user experiment studies trust calibration, reliance, explanation understanding, and cognitive load in AI-assisted decision support.",
    authors: ["Test Author"],
    institutions: ["Test University"],
    venue: "CHI",
    source: "test",
    publishedAt: new Date().toISOString(),
    firstSeenAt: new Date().toISOString(),
    url: "https://example.org/test",
    ...overrides
  };
}

function paper(overrides = {}) {
  return enrichPaper(paperInput(overrides));
}

test("classifier promotes human-centered AI papers", () => {
  const result = classifyPaper(paperInput());
  assert.equal(result.reviewStatus, "auto_approved");
  assert.equal(result.primaryDirection, "trust-reliance");
  assert.ok(result.hcaiScore >= 70);
  assert.ok(result.researchQuestions.includes("Trust Calibration"));
});

test("classifier excludes algorithm-only papers", () => {
  const result = classifyPaper({
    title: "Segmentation Benchmark",
    abstract: "A dataset, benchmark, architecture, optimizer, and state-of-the-art classification accuracy result.",
    venue: "arXiv"
  });
  assert.equal(result.reviewStatus, "excluded");
  assert.ok(result.hcaiScore < 50);
});

test("paper listing filters by direction and query", async () => {
  const db = {
    papers: [
      await paper({ id: "a" }),
      await paper({
        id: "b",
        title: "AI Tutors in Education",
        abstract: "A student user experiment studies AI tutor feedback and learning.",
        url: "https://example.org/tutor"
      })
    ],
    updateLogs: [],
    meta: {}
  };
  const trust = listPapers(db, { direction: "trust-reliance" });
  assert.equal(trust.total, 1);
  const search = listPapers(db, { q: "student" });
  assert.equal(search.total, 1);
  assert.equal(search.items[0].id, "b");
});

test("dashboard and direction detail aggregate papers", async () => {
  const db = { papers: [await paper({ id: "a" })], updateLogs: [], meta: { lastUpdateAt: null } };
  const dashboard = buildDashboard(db);
  assert.equal(dashboard.metrics.totalPapers, 1);
  assert.ok(dashboard.hotDirections.length > 0);
  const detail = getDirectionDetail(db, "trust-reliance");
  assert.equal(detail.paperCount, 1);
});
