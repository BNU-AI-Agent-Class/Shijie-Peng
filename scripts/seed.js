import { createEmptyDb, writeDb } from "../src/backend/store/fileStore.js";
import { enrichPaper } from "../src/backend/services/updateJob.js";
import { daysAgo, stableId } from "../src/backend/lib/utils.js";

const samples = [
  {
    title: "Calibrating Reliance: How Clinicians Use AI-Generated Explanations",
    abstract:
      "A mixed-methods user experiment with radiologists studies trust calibration, overreliance, and explanation understanding in AI-assisted decision support. Participants used an explainable AI interface and reported cognitive load, trust, and sense of control.",
    authors: ["Maya Chen", "Daniel Ruiz", "Priya Shah"],
    institutions: ["Stanford University", "Carnegie Mellon University", "University of Washington"],
    venue: "CHI 2026",
    source: "seed",
    publishedAt: daysAgo(1),
    url: "https://example.org/calibrating-reliance"
  },
  {
    title: "When the Agent Drives: Designing Handoff Moments in LLM Co-Programming",
    abstract:
      "This diary study with software developers examines human control of AI agents, handoff behavior, and user mental models in an LLM coding assistant. The work contributes design implications for mixed-initiative agentic workflows.",
    authors: ["Lena Hoffmann", "Arjun Patel"],
    institutions: ["Carnegie Mellon University", "Georgia Tech"],
    venue: "UIST 2026",
    source: "seed",
    publishedAt: daysAgo(2),
    url: "https://example.org/agent-handoff"
  },
  {
    title: "Steering Multiple Minds: A Control Interface for Human Oversight of Agent Teams",
    abstract:
      "We present a prototype interface for supervising multi-agent collaboration. A controlled study with participants measures workload, trust, human override behavior, and coordination quality when users monitor autonomous agent teams.",
    authors: ["Noah Kim", "Sara Varga", "Keiko Tanaka"],
    institutions: ["MIT", "Cornell University", "University of Tokyo"],
    venue: "CSCW 2026",
    source: "seed",
    publishedAt: daysAgo(3),
    url: "https://example.org/multi-agent-oversight"
  },
  {
    title: "The Learner in the Loop: Interpreting LLM Feedback in AI-Supported Writing",
    abstract:
      "A classroom field study explores how students and teachers interpret LLM feedback, accept AI suggestions, and maintain agency during writing. We report survey and interview findings on trust, usefulness, and learning outcomes.",
    authors: ["Emily Zhang", "Mateo Garcia"],
    institutions: ["University of Michigan", "Tsinghua University"],
    venue: "LAK 2026",
    source: "seed",
    publishedAt: daysAgo(4),
    url: "https://example.org/llm-feedback-learning"
  },
  {
    title: "Designing Empathic Boundaries for Mental Health Chatbots",
    abstract:
      "This interview and user experiment investigates AI mental health chatbots, perceived empathy, risk disclosure, and user trust. The study proposes guidelines for safe handoff and transparent intervention boundaries.",
    authors: ["Sofia Mendes", "Iris Wang"],
    institutions: ["University College London", "Peking University"],
    venue: "JMIR Human Factors",
    source: "seed",
    publishedAt: daysAgo(5),
    url: "https://example.org/mental-health-chatbots"
  },
  {
    title: "Algorithm Aversion After a Wrong Recommendation",
    abstract:
      "A survey and controlled experiment measure algorithm aversion, algorithm appreciation, trust recovery, and reliance after users observe an AI recommendation system make an error in workplace decision support.",
    authors: ["Jonas Meyer", "Fatima Ali"],
    institutions: ["University of Oxford", "ETH Zurich"],
    venue: "HCOMP 2026",
    source: "seed",
    publishedAt: daysAgo(6),
    url: "https://example.org/algorithm-aversion"
  },
  {
    title: "Transparency Without Overload: Explanation Design for Everyday AI",
    abstract:
      "We compare explanation interfaces for consumer AI tools through a between-subject user experiment. Results show how explanation detail affects cognitive load, satisfaction, trust, and user understanding.",
    authors: ["Hannah Lee", "Victor Stone"],
    institutions: ["University of Toronto", "EPFL"],
    venue: "IUI 2026",
    source: "seed",
    publishedAt: daysAgo(8),
    url: "https://example.org/explanation-overload"
  },
  {
    title: "Human-Centered Evaluation of Generative AI Design Tools",
    abstract:
      "A longitudinal field study with designers evaluates a generative AI prototype for ideation and critique. We analyze user experience, creative control, acceptance, and collaboration between human designers and AI.",
    authors: ["Nora Singh", "Alex Rivera"],
    institutions: ["Royal College of Art", "Adobe Research"],
    venue: "DIS 2026",
    source: "seed",
    publishedAt: daysAgo(9),
    url: "https://example.org/generative-design-tools"
  },
  {
    title: "Responsible AI Notices in High-Stakes Public Services",
    abstract:
      "This qualitative interview study examines accountability, fairness, transparency, and user understanding of AI notices in public benefit decision support systems. Findings inform responsible AI governance and design.",
    authors: ["Amara Okafor", "Evan Brooks"],
    institutions: ["University of Amsterdam", "NYU"],
    venue: "FAccT 2026",
    source: "seed",
    publishedAt: daysAgo(10),
    url: "https://example.org/responsible-ai-notices"
  },
  {
    title: "Affective Signals and Trust in Social Robots",
    abstract:
      "A human-robot interaction user experiment studies how social robot emotion displays influence trust, perceived empathy, reliance, and collaboration quality in older adult assistance scenarios.",
    authors: ["Yuki Nakamura", "Clara Rossi"],
    institutions: ["University of Tokyo", "Politecnico di Milano"],
    venue: "HRI 2026",
    source: "seed",
    publishedAt: daysAgo(11),
    url: "https://example.org/social-robot-affect"
  },
  {
    title: "Mental Models of Large Language Models in Knowledge Work",
    abstract:
      "Through interviews and log analysis, we study how knowledge workers form mental models of LLM capabilities, decide when to rely on AI, and recover from confusing generated answers.",
    authors: ["Rachel Green", "Min Zhou"],
    institutions: ["Microsoft Research", "Hong Kong University"],
    venue: "CSCW 2026",
    source: "seed",
    publishedAt: daysAgo(12),
    url: "https://example.org/llm-mental-models"
  },
  {
    title: "Mixed-Initiative Planning for Human-AI Field Teams",
    abstract:
      "A prototype system supports mixed-initiative planning between human operators and AI agents. A field study measures situation awareness, workload, override behavior, and team coordination.",
    authors: ["Owen Miller", "Jia Li"],
    institutions: ["Delft University of Technology", "National University of Singapore"],
    venue: "CHI 2026",
    source: "seed",
    publishedAt: daysAgo(14),
    url: "https://example.org/mixed-initiative-field-teams"
  },
  {
    title: "AI-Mediated Communication in Distributed Design Reviews",
    abstract:
      "This study explores AI-mediated collaboration in remote design reviews. We analyze meeting logs, user interviews, trust in AI summaries, and perceived control over generated action items.",
    authors: ["Mina Park", "Oliver Smith"],
    institutions: ["KAIST", "University of Edinburgh"],
    venue: "CSCW 2026",
    source: "seed",
    publishedAt: daysAgo(17),
    url: "https://example.org/ai-mediated-design-reviews"
  },
  {
    title: "Human Factors of AI Decision Support in Emergency Rooms",
    abstract:
      "A simulation experiment with clinicians examines cognitive load, situation awareness, and trust calibration when using AI-assisted decision support for triage. The interface includes confidence display and explanation controls.",
    authors: ["Laura Bennett", "Ahmed Khan"],
    institutions: ["Johns Hopkins University", "Imperial College London"],
    venue: "HFES 2026",
    source: "seed",
    publishedAt: daysAgo(20),
    url: "https://example.org/er-ai-human-factors"
  },
  {
    title: "Acceptance of AI Tutors Across Feedback Styles",
    abstract:
      "A survey and classroom user experiment study AI acceptance, student trust, feedback interpretation, and teacher oversight for LLM tutor systems in secondary education.",
    authors: ["Caroline Wu", "Samir Gupta"],
    institutions: ["University of Cambridge", "Zhejiang University"],
    venue: "AIED 2026",
    source: "seed",
    publishedAt: daysAgo(24),
    url: "https://example.org/ai-tutor-feedback"
  },
  {
    title: "Confidence Displays for Human-AI Collaboration",
    abstract:
      "A controlled user experiment investigates how confidence display formats influence reliance, human override behavior, decision accuracy, and satisfaction in human-AI collaboration tasks.",
    authors: ["Nicolas Dubois", "Grace Lee"],
    institutions: ["INRIA", "Seoul National University"],
    venue: "IUI 2026",
    source: "seed",
    publishedAt: daysAgo(28),
    url: "https://example.org/confidence-displays"
  },
  {
    title: "User Perceptions of AI Summaries in Weekly Reports",
    abstract:
      "A survey examines user perception of AI generated summaries in workplace reports, focusing on usefulness, acceptance, and when employees choose to rely on the output.",
    authors: ["Nadine Cole", "Peter Huang"],
    institutions: ["University of British Columbia"],
    venue: "arXiv",
    source: "seed",
    publishedAt: daysAgo(2),
    url: "https://example.org/user-perceptions-ai-summaries"
  },
  {
    title: "Robust Segmentation Benchmark for Medical Images",
    abstract:
      "We introduce a dataset, model architecture, optimizer, and benchmark for state-of-the-art medical image segmentation accuracy. The paper focuses on training efficiency and classification accuracy.",
    authors: ["Benchmark Team"],
    institutions: ["Example Lab"],
    venue: "arXiv",
    source: "seed",
    publishedAt: daysAgo(2),
    url: "https://example.org/segmentation-benchmark"
  },
  {
    title: "A Taxonomy of Human-AI Role Allocation in Creative Work",
    abstract:
      "Based on interviews with writers, designers, and creators, this paper develops a taxonomy of human-AI role allocation, creative control, user experience, and generative AI tool adoption.",
    authors: ["Isabel Martin", "Wei Sun"],
    institutions: ["University of Sydney", "Fudan University"],
    venue: "TOCHI 2026",
    source: "seed",
    publishedAt: daysAgo(31),
    url: "https://example.org/role-allocation-creative-ai"
  }
];

const db = createEmptyDb();
db.papers = samples.map((sample) => {
  const id = stableId("paper", sample.url ?? sample.title);
  return enrichPaper({
    id,
    ...sample,
    year: new Date(sample.publishedAt).getUTCFullYear(),
    firstSeenAt: sample.publishedAt
  });
});
db.updateLogs = [
  {
    id: `seed_${Date.now()}`,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: "completed",
    source: "seed",
    windowHours: 72,
    fetched: samples.length,
    inserted: samples.length,
    updated: 0,
    approved: db.papers.filter((paper) => paper.reviewStatus === "auto_approved").length,
    pendingReview: db.papers.filter((paper) => paper.reviewStatus === "pending_review").length,
    excluded: db.papers.filter((paper) => paper.reviewStatus === "excluded").length,
    message: "Seeded demo HCAI paper corpus."
  }
];
db.meta.lastUpdateAt = db.updateLogs[0].finishedAt;

await writeDb(db);
console.log(`Seeded ${db.papers.length} papers into data/db.json`);
