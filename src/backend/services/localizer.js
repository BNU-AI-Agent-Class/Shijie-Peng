import { directions } from "../config/taxonomy.js";

const directionById = new Map(directions.map((direction) => [direction.id, direction]));

const questionZh = {
  "Trust Calibration": "信任校准",
  "Overreliance on AI": "过度依赖 AI",
  "Human Control of AI Agents": "AI 智能体的人类控制",
  "Explanation Understanding": "AI 解释理解",
  "AI Decision Accountability": "AI 决策问责",
  "Cognitive Load in AI Use": "AI 使用中的认知负荷",
  "Human Override Behavior": "人类覆盖与接管行为",
  "AI Feedback Interpretation": "AI 反馈解读",
  "AI-mediated Collaboration": "AI 媒介协作",
  "Human Evaluation of LLMs": "大模型的人类评估",
  "Human-AI Role Allocation": "人智角色分配",
  "User Mental Models of AI": "用户对 AI 的心智模型",
  "AI Acceptance and Adoption": "AI 接受与采纳",
  "AI-supported Learning": "AI 支持学习",
  "AI-supported Mental Health Intervention": "AI 支持心理健康干预",
  "Algorithm Aversion": "算法厌恶",
  "Algorithm Appreciation": "算法欣赏",
  "Agent Handoff": "智能体交接",
  "Multi-Agent Supervision": "多智能体监督",
  "Confidence Display": "置信度展示"
};

const methodZh = {
  "User Experiment": "用户实验",
  Interview: "访谈",
  Survey: "问卷",
  "Log Analysis": "日志分析",
  Prototype: "原型系统",
  "Field Study": "田野研究"
};

const contextZh = {
  Healthcare: "医疗",
  Education: "教育",
  Programming: "编程",
  Writing: "写作",
  Workplace: "工作场景",
  "Mental Health": "心理健康",
  "Decision Support": "决策支持"
};

const groupZh = {
  Clinicians: "临床医生",
  Students: "学生",
  Teachers: "教师",
  Developers: "开发者",
  "Creative Professionals": "创意工作者",
  "General Users": "普通用户"
};

const systemZh = {
  LLM: "大语言模型",
  "AI Agent": "AI 智能体",
  "Decision Support System": "决策支持系统",
  "Recommendation System": "推荐系统",
  "Generative AI Tool": "生成式 AI 工具",
  "AI System": "AI 系统"
};

const phraseZhRules = [
  ["large language models", "大语言模型"],
  ["large language model", "大语言模型"],
  ["generative artificial intelligence", "生成式人工智能"],
  ["generative ai", "生成式 AI"],
  ["artificial intelligence", "人工智能"],
  ["human-centered ai", "人本 AI"],
  ["human-centred ai", "人本 AI"],
  ["human-ai interaction", "人智交互"],
  ["human-ai collaboration", "人智协作"],
  ["human-agent interaction", "人与智能体交互"],
  ["human control", "人类控制"],
  ["ai agent", "AI 智能体"],
  ["ai agents", "AI 智能体"],
  ["autonomous agents", "自主智能体"],
  ["multi-agent", "多智能体"],
  ["explainable ai", "可解释 AI"],
  ["explanation", "解释"],
  ["explanations", "解释"],
  ["interpretability", "可解释性"],
  ["transparency", "透明性"],
  ["trust calibration", "信任校准"],
  ["overreliance", "过度依赖"],
  ["underreliance", "不足依赖"],
  ["reliance", "依赖"],
  ["trust", "信任"],
  ["user study", "用户研究"],
  ["user studies", "用户研究"],
  ["participants", "参与者"],
  ["participant", "参与者"],
  ["interview", "访谈"],
  ["interviews", "访谈"],
  ["survey", "问卷"],
  ["surveys", "问卷"],
  ["experiment", "实验"],
  ["experiments", "实验"],
  ["field study", "田野研究"],
  ["prototype", "原型"],
  ["evaluation", "评估"],
  ["cognitive load", "认知负荷"],
  ["mental model", "心智模型"],
  ["mental models", "心智模型"],
  ["decision support", "决策支持"],
  ["decision-making", "决策"],
  ["decision making", "决策"],
  ["healthcare", "医疗健康"],
  ["clinical", "临床"],
  ["education", "教育"],
  ["learning", "学习"],
  ["student", "学生"],
  ["students", "学生"],
  ["teacher", "教师"],
  ["teachers", "教师"],
  ["developer", "开发者"],
  ["developers", "开发者"],
  ["programming", "编程"],
  ["coding", "编程"],
  ["writing", "写作"],
  ["workplace", "工作场景"],
  ["mental health", "心理健康"],
  ["chatbot", "聊天机器人"],
  ["chatbots", "聊天机器人"],
  ["recommendation", "推荐"],
  ["recommendations", "推荐"],
  ["responsible ai", "负责任 AI"],
  ["fairness", "公平性"],
  ["accountability", "问责"],
  ["privacy", "隐私"],
  ["safety", "安全性"],
  ["we propose", "我们提出"],
  ["we present", "我们提出"],
  ["we introduce", "我们介绍"],
  ["we investigate", "我们研究"],
  ["we examine", "我们考察"],
  ["we evaluate", "我们评估"],
  ["we find that", "我们发现"],
  ["we found that", "我们发现"],
  ["this paper", "本文"],
  ["this study", "本研究"],
  ["our results show that", "结果表明"],
  ["results show that", "结果表明"],
  ["the results show that", "结果表明"],
  ["the findings suggest that", "研究发现表明"],
  ["findings suggest that", "研究发现表明"],
  ["in this paper", "在本文中"],
  ["in this study", "在本研究中"]
];

export async function localizePaper(paper) {
  const [titleResult, abstractResult] = await Promise.all([
    translateText(paper.title || "", { title: true }),
    translateText(paper.abstract || "", { title: false })
  ]);

  return {
    ...paper,
    titleZh: titleResult.text || paper.title || "",
    abstractZh: abstractResult.text || "",
    localization: {
      zh: {
        status: "generated",
        method: abstractResult.method || titleResult.method || "machine_translation_from_source_text",
        generatedAt: new Date().toISOString(),
        sourceTitle: paper.title || "",
        sourceAbstractHash: hashText(paper.abstract || ""),
        note: abstractResult.ok
          ? "中文标题和摘要基于原始标题与原始摘要自动机器翻译；源数据缺失摘要时不会编造摘要。"
          : "自动翻译失败或源数据缺失摘要时，页面会展示原始英文摘要。"
      }
    }
  };
}

async function translateText(value, options = {}) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return { text: "", ok: false, method: "source_text_missing" };
  try {
    const translated = await translateViaGoogle(text, options);
    if (translated) return { text: translated, ok: true, method: "google_translate_gtx" };
  } catch {
    // Do not expose the old keyword-replacement fallback. It produced mixed
    // English/Chinese fragments that looked like broken translations.
  }
  return {
    text: options.title ? text : "",
    ok: false,
    method: "machine_translation_unavailable"
  };
}

async function translateViaGoogle(text, options = {}) {
  const chunks = options.title ? [text] : chunkText(text, 1300).slice(0, 8);
  const translated = [];
  for (const chunk of chunks) {
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", "en");
    url.searchParams.set("tl", "zh-CN");
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", chunk);
    const response = await fetch(url, {
      headers: { "User-Agent": "hcai-research-map/0.1" },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`translation_failed_${response.status}`);
    const payload = await response.json();
    const textPart = (payload?.[0] || []).map((item) => item?.[0] || "").join("");
    if (!textPart) throw new Error("translation_empty");
    translated.push(textPart);
  }
  return translated.join(options.title ? "" : "");
}

function chunkText(text, maxLength) {
  const sentences = splitSentences(text);
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && `${current} ${sentence}`.length > maxLength) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function translateList(values = [], dictionary) {
  return [...new Set(values.map((value) => dictionary[value] || value).filter(Boolean))];
}

function translateEnglishToChineseDraft(value, options = {}) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const sentences = options.title ? [text] : splitSentences(text).slice(0, 8);
  const translated = sentences.map((sentence) => translateSentence(sentence, options)).filter(Boolean).join(options.title ? "" : "");
  return cleanupChineseDraft(translated);
}

function splitSentences(text) {
  const matches = text.match(/[^.!?。！？]+[.!?。！？]?/g);
  return matches?.map((item) => item.trim()).filter(Boolean) || [text];
}

function translateSentence(sentence, options = {}) {
  let output = ` ${sentence} `;
  for (const [source, target] of phraseZhRules) {
    output = output.replace(new RegExp(escapeRegExp(source), "gi"), target);
  }

  output = output
    .replace(/\bAI\b/g, "AI")
    .replace(/\bLLM\b/g, "大语言模型")
    .replace(/\bLLMs\b/g, "大语言模型")
    .replace(/\busers\b/gi, "用户")
    .replace(/\buser\b/gi, "用户")
    .replace(/\bhuman\b/gi, "人类")
    .replace(/\bhumans\b/gi, "人类")
    .replace(/\bsystem\b/gi, "系统")
    .replace(/\bsystems\b/gi, "系统")
    .replace(/\bmodel\b/gi, "模型")
    .replace(/\bmodels\b/gi, "模型")
    .replace(/\bdata\b/gi, "数据")
    .replace(/\bmethod\b/gi, "方法")
    .replace(/\bmethods\b/gi, "方法")
    .replace(/\btask\b/gi, "任务")
    .replace(/\btasks\b/gi, "任务")
    .replace(/\bdesign\b/gi, "设计")
    .replace(/\binterface\b/gi, "界面")
    .replace(/\bperformance\b/gi, "表现")
    .replace(/\baccuracy\b/gi, "准确率")
    .replace(/\bbehavior\b/gi, "行为")
    .replace(/\bbehaviour\b/gi, "行为")
    .replace(/\bexperience\b/gi, "体验")
    .replace(/\bperception\b/gi, "感知")
    .replace(/\bcollaboration\b/gi, "协作")
    .replace(/\bcontrol\b/gi, "控制")
    .replace(/\bfeedback\b/gi, "反馈")
    .replace(/\bframework\b/gi, "框架")
    .replace(/\bapproach\b/gi, "方法")
    .replace(/\bchallenge\b/gi, "挑战")
    .replace(/\bchallenges\b/gi, "挑战")
    .replace(/\bopportunities\b/gi, "机会")
    .replace(/\bopportunity\b/gi, "机会")
    .replace(/\bimportant\b/gi, "重要")
    .replace(/\beffective\b/gi, "有效")
    .replace(/\bnovel\b/gi, "新的")
    .replace(/\bempirical\b/gi, "实证")
    .replace(/\bqualitative\b/gi, "定性")
    .replace(/\bquantitative\b/gi, "定量")
    .replace(/\bmixed-methods\b/gi, "混合方法")
    .replace(/\bmixed methods\b/gi, "混合方法")
    .replace(/\bN\s*=\s*/g, "样本量 N=")
    .trim();

  output = output.replace(/\s+([,.;:!?])/g, "$1").replace(/\s+/g, " ");
  if (options.title) return output;
  return /[。！？.!?]$/.test(output) ? output.replace(/[.!?]$/, "。") : `${output}。`;
}

function cleanupChineseDraft(value) {
  return String(value)
    .replace(/\s*。\s*/g, "。")
    .replace(/\s*，\s*/g, "，")
    .replace(/\s+/g, " ")
    .replace(/ \)/g, ")")
    .replace(/\( /g, "(")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hashText(value) {
  let hash = 0;
  for (const char of String(value || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(16);
}
