import { contextTerms, directions, methodTerms, researchQuestionSeeds } from "../config/taxonomy.js";
import { clamp, includesAny, normalizeText, unique } from "../lib/utils.js";

const strongHumanTerms = [
  "user",
  "human",
  "participant",
  "interview",
  "survey",
  "experiment",
  "perception",
  "trust",
  "reliance",
  "collaboration",
  "interaction",
  "experience",
  "control",
  "decision",
  "cognitive",
  "mental model"
];

const aiTerms = [
  "ai",
  "artificial intelligence",
  "machine learning",
  "llm",
  "large language model",
  "agent",
  "algorithm",
  "model",
  "chatbot",
  "generative"
];

const algorithmOnlyTerms = [
  "benchmark",
  "state-of-the-art",
  "training",
  "dataset",
  "architecture",
  "optimizer",
  "segmentation",
  "classification accuracy",
  "accelerator",
  "fpga",
  "hardware design",
  "compiler",
  "throughput",
  "latency",
  "yang-baxter",
  "r-matrices",
  "spectral parameters",
  "bio-capabilities benchmark",
  "biosecurity benchmark",
  "mmwave sensing"
];

const infrastructureOnlyTerms = [
  "llm serving",
  "serving on commodity",
  "trusted execution environment",
  "trusted execution environments",
  "tees",
  "secure enclave",
  "confidential computing",
  "confidential llm",
  "privacy-preserving serving",
  "inference serving",
  "model serving",
  "compiler",
  "accelerator generation",
  "hardware accelerator"
];

const coreHcaiPatterns = [
  /\bhuman[- ]ai\b/i,
  /\bhuman[- ]centered ai\b/i,
  /\bhuman[- ]centred ai\b/i,
  /\bhuman[- ]computer interaction\b/i,
  /\bhuman[- ]agent interaction\b/i,
  /\bhuman[- ]robot interaction\b/i,
  /\buser (study|experiment|survey|interview|evaluation|research|experience|perception|trust|control|interaction)\b/i,
  /\b(users?|participants?|clinicians?|students?|teachers?|developers?|designers?|readers?|patients?)\b.{0,80}\b(ai|llm|agent|algorithm|chatbot|model)\b/i,
  /\b(ai|llm|agent|algorithm|chatbot|model)\b.{0,80}\b(users?|participants?|clinicians?|students?|teachers?|developers?|designers?|readers?|patients?)\b/i,
  /\btrust (in|of) ai\b/i,
  /\breliance on ai\b/i,
  /\bover[- ]?reliance\b/i,
  /\balgorithm aversion\b/i,
  /\balgorithm appreciation\b/i,
  /\bai disclosure\b/i,
  /\bai transparency\b/i,
  /\bexplanation (interface|design|understanding)\b/i,
  /\bparticipatory design\b/i,
  /\bfield study\b/i,
  /\bdiary study\b/i,
  /\bcontrolled (user )?experiment\b/i
];

export function classifyPaper(input) {
  const title = normalizeText(input.title);
  const abstract = normalizeText(input.abstract);
  const venue = normalizeText(input.venue);
  const text = `${title} ${abstract} ${venue}`.toLowerCase();

  const matchedDirections = directions
    .map((direction) => {
      const aliasHits = direction.aliases.filter((alias) => text.includes(alias.toLowerCase())).length;
      const nameHit = text.includes(direction.name.toLowerCase()) ? 1 : 0;
      return { direction, score: aliasHits * 18 + nameHit * 22 };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const humanHits = strongHumanTerms.filter((term) => text.includes(term)).length;
  const aiHits = aiTerms.filter((term) => text.includes(term)).length;
  const negativeHits = algorithmOnlyTerms.filter((term) => text.includes(term)).length;
  const infrastructureHits = infrastructureOnlyTerms.filter((term) => text.includes(term)).length;
  const methodHits = Object.values(methodTerms).flat().filter((term) => text.includes(term)).length;
  const hasCoreHcaiSignal = coreHcaiPatterns.some((pattern) => pattern.test(text));
  const hasSourceLink = Boolean(input.url || input.doi || input.pdfUrl);
  const hasFuturePublicationDate = isFuturePublicationDate(input.publishedAt);
  const hasAbstract = Boolean(String(input.abstract || "").trim());

  let score = 35;
  score += Math.min(humanHits * 7, 28);
  score += Math.min(aiHits * 5, 18);
  score += Math.min(matchedDirections.reduce((sum, item) => sum + item.score, 0), 26);
  score += Math.min(methodHits * 4, 12);
  score -= Math.min(negativeHits * 8, 24);
  if (humanHits === 0) score -= 20;
  if (aiHits === 0) score -= 18;
  if (!hasCoreHcaiSignal) score -= 32;
  if (!hasSourceLink) score -= 20;
  if (infrastructureHits > 0) score -= 40;
  if (infrastructureHits > 0 && methodHits === 0) score = Math.min(score, 49);
  if (negativeHits > 0 && !hasCoreHcaiSignal) score = Math.min(score, 49);
  score = clamp(Math.round(score), 0, 100);

  const primaryDirection = matchedDirections[0]?.direction.id ?? inferFallbackDirection(text);
  const secondaryDirections = unique(matchedDirections.slice(1, 5).map((item) => item.direction.id));
  const researchQuestions = inferResearchQuestions(text);
  const researchMethods = inferTerms(text, methodTerms);
  const applicationContexts = inferTerms(text, contextTerms);
  const aiSystemTypes = inferSystemTypes(text);
  const userGroups = inferUserGroups(text);
  const evaluationMetrics = inferMetrics(text);
  const reviewStatus = hasSourceLink && hasAbstract && hasCoreHcaiSignal && !hasFuturePublicationDate && score >= 70 ? "auto_approved" : score >= 50 ? "pending_review" : "excluded";
  const confidence = score >= 85 ? "high" : score >= 70 ? "medium" : score >= 50 ? "low" : "very_low";

  return {
    hcaiScore: score,
    primaryDirection,
    secondaryDirections,
    researchQuestions,
    researchMethods,
    applicationContexts,
    userGroups,
    aiSystemTypes,
    interactionModes: inferInteractionModes(text),
    evaluationMetrics,
    contributionTypes: inferContributionTypes(text),
    reviewStatus,
    confidence,
    classificationReason: buildReason({
      score,
      primaryDirection,
      humanHits,
      aiHits,
      hasCoreHcaiSignal,
      hasSourceLink,
      hasFuturePublicationDate,
      hasAbstract,
      researchQuestions,
      researchMethods,
      applicationContexts
    })
  };
}

function inferFallbackDirection(text) {
  if (text.includes("trust") || text.includes("reliance")) return "trust-reliance";
  if (text.includes("explain")) return "explainable-ai";
  if (text.includes("agent")) return "ai-agents";
  if (text.includes("education") || text.includes("learning")) return "ai-education";
  if (text.includes("mental health") || text.includes("therapy")) return "ai-mental-health";
  if (text.includes("llm") || text.includes("large language model")) return "llm-user-study";
  return "human-ai-interaction";
}

function inferResearchQuestions(text) {
  const rules = [
    ["Trust Calibration", ["trust calibration", "calibrat", "appropriate trust"]],
    ["Overreliance on AI", ["overreliance", "over-reliance", "over trust", "automation bias"]],
    ["Human Control of AI Agents", ["control", "handoff", "takeover", "supervise", "agent"]],
    ["Explanation Understanding", ["explanation", "explainable", "interpretability", "xai"]],
    ["AI Decision Accountability", ["accountability", "responsibility", "decision support"]],
    ["Cognitive Load in AI Use", ["cognitive load", "workload", "mental effort"]],
    ["Human Evaluation of LLMs", ["human evaluation", "llm", "large language model"]],
    ["AI Feedback Interpretation", ["feedback", "learning", "student"]],
    ["User Mental Models of AI", ["mental model", "perception", "understanding"]],
    ["AI-supported Mental Health Intervention", ["mental health", "therapy", "intervention"]]
  ];
  const found = rules.filter(([, terms]) => includesAny(text, terms)).map(([name]) => name);
  return unique(found.length ? found : [researchQuestionSeeds[0]]);
}

function inferTerms(text, dictionary) {
  return Object.entries(dictionary)
    .filter(([, terms]) => includesAny(text, terms))
    .map(([label]) => label);
}

function inferSystemTypes(text) {
  const types = [];
  if (includesAny(text, ["llm", "large language model", "chatgpt"])) types.push("LLM");
  if (includesAny(text, ["agent", "autonomous"])) types.push("AI Agent");
  if (includesAny(text, ["decision support", "clinical decision"])) types.push("Decision Support System");
  if (includesAny(text, ["recommendation", "recommender"])) types.push("Recommendation System");
  if (includesAny(text, ["generative", "writing assistant", "coding assistant"])) types.push("Generative AI Tool");
  return unique(types.length ? types : ["AI System"]);
}

function inferUserGroups(text) {
  const groups = [];
  if (includesAny(text, ["doctor", "clinician", "radiologist", "nurse"])) groups.push("Clinicians");
  if (includesAny(text, ["student", "learner"])) groups.push("Students");
  if (includesAny(text, ["teacher", "instructor"])) groups.push("Teachers");
  if (includesAny(text, ["developer", "programmer", "engineer"])) groups.push("Developers");
  if (includesAny(text, ["designer", "writer", "creator"])) groups.push("Creative Professionals");
  if (includesAny(text, ["participant", "user"])) groups.push("General Users");
  return unique(groups.length ? groups : ["General Users"]);
}

function inferMetrics(text) {
  const metrics = [];
  if (text.includes("trust")) metrics.push("Trust");
  if (text.includes("reliance")) metrics.push("Reliance");
  if (text.includes("accuracy")) metrics.push("Decision Accuracy");
  if (text.includes("cognitive load") || text.includes("workload")) metrics.push("Cognitive Load");
  if (text.includes("satisfaction")) metrics.push("Satisfaction");
  if (text.includes("control")) metrics.push("Sense of Control");
  return unique(metrics.length ? metrics : ["Usefulness"]);
}

function inferInteractionModes(text) {
  const modes = [];
  if (includesAny(text, ["collaboration", "collaborative"])) modes.push("Human-AI Collaboration");
  if (includesAny(text, ["decision support", "decision-making", "decision making"])) modes.push("AI-assisted Decision Making");
  if (includesAny(text, ["mixed-initiative", "handoff"])) modes.push("Mixed-Initiative");
  if (includesAny(text, ["multi-agent", "agent team"])) modes.push("Multi-Agent Collaboration");
  return unique(modes.length ? modes : ["Human-AI Interaction"]);
}

function inferContributionTypes(text) {
  const types = [];
  if (includesAny(text, ["experiment", "study", "survey", "interview"])) types.push("Empirical Finding");
  if (includesAny(text, ["prototype", "system", "interface", "tool"])) types.push("System Design");
  if (includesAny(text, ["framework", "model", "taxonomy"])) types.push("Framework");
  if (includesAny(text, ["guideline", "principle", "recommendation"])) types.push("Design Implication");
  return unique(types.length ? types : ["Empirical Finding"]);
}

function isFuturePublicationDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return false;
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return date > tomorrow;
}

function buildReason({ score, primaryDirection, humanHits, aiHits, hasCoreHcaiSignal, hasSourceLink, hasFuturePublicationDate, hasAbstract, researchQuestions, researchMethods, applicationContexts }) {
  const direction = directions.find((item) => item.id === primaryDirection)?.name ?? primaryDirection;
  const parts = [
    `该论文命中 ${direction} 方向。`,
    `文本中同时出现人与 AI 相关信号（human/user 命中 ${humanHits} 类，AI 命中 ${aiHits} 类）。`,
    `核心 HCAI 交互信号：${hasCoreHcaiSignal ? "有" : "不足"}；真实来源链接：${hasSourceLink ? "有" : "缺失"}。`
  ];
  if (hasFuturePublicationDate) parts.push("该记录的发表日期晚于当前日期，需进入待审池核对来源日期。");
  if (!hasAbstract) parts.push("该数据源未提供摘要，需进入待审池补充摘要后再公开。");
  if (researchQuestions.length) parts.push(`可提取研究问题：${researchQuestions.join("、")}。`);
  if (researchMethods.length) parts.push(`研究方法线索：${researchMethods.join("、")}。`);
  if (applicationContexts.length) parts.push(`应用场景线索：${applicationContexts.join("、")}。`);
  parts.push(`综合 HCAI 分数为 ${score}。`);
  return parts.join("");
}
