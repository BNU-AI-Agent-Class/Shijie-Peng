(function () {
  const lang = document.documentElement.lang && document.documentElement.lang.startsWith("zh") ? "zh" : "en";
  const t = {
    zh: {
      today: "今日入库",
      last7: "近 7 日",
      total: "看板论文",
      directions: "覆盖研究方向",
      pending: "待审论文",
      updated: "最近更新",
      papers: "篇",
      score: "HCAI",
      noData: "暂无真实数据，等待下一次抓取",
      sourceOk: "真实数据源已连接",
      sourcePartial: "部分数据源异常",
      updatedAt: "最近更新",
      listCount: (total, shown) => `共 ${total} 篇 · 当前显示 ${shown} 篇`,
      homeMeta: (count) => `${count} 篇 · 按 HCAI 分数排序`,
      fetchedAt: (date) => `入库数据 · ${date}`
    },
    en: {
      today: "Indexed Today",
      last7: "Last 7 Days",
      total: "Board Papers",
      directions: "Directions",
      pending: "Review Queue",
      updated: "Last Update",
      papers: "papers",
      score: "HCAI",
      noData: "No live data yet; waiting for next update",
      sourceOk: "Live sources connected",
      sourcePartial: "Some sources need attention",
      updatedAt: "Last update",
      listCount: (total, shown) => `${total} papers total · showing ${shown}`,
      homeMeta: (count) => `${count} papers · sorted by HCAI score`,
      fetchedAt: (date) => `Indexed data · ${date}`
    }
  }[lang];

  let directionNames = {};
  let paperCache = new Map();
  let directionCache = new Map();
  let liveState = {
    dashboard: null,
    papers: [],
    directions: [],
    directionDetails: []
  };
  let defaultPaperId = "";
  let activePaperId = "";
  let defaultDirectionId = "";
  let activeDirectionId = "";
  let paperListSort = "recent";
  let paperListWindowDays = 30;
  let paperListMinScore = 70;
  let paperListQuery = "";
  let paperSearchTimer = 0;
  const paperListFilters = {
    direction: [],
    question: [],
    method: [],
    context: [],
    userGroup: [],
    aiType: [],
    contributionType: [],
    source: []
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  installDetailRouteGuard();
  installPaperListControls();
  clearStaticPaperDetail();

  hydrate().then(markLiveReady).catch((error) => {
    console.warn("HCAI live data hydrate failed", error);
    markLiveError(error);
  });

  async function hydrate() {
    const [dashboard, papers, facets, meta, directionsPayload] = await Promise.all([
      getJson("/api/dashboard"),
      getJson(paperListUrl()),
      getJson(paperFacetsUrl()),
      getJson("/api/meta"),
      getJson("/api/directions")
    ]);
    const directions = directionsPayload.items || [];
    liveState = {
      dashboard,
      papers: papers.items || [],
      directions,
      directionDetails: []
    };
    directionNames = Object.fromEntries((meta.taxonomy?.directions || []).map((direction) => [
      direction.id,
      lang === "zh" ? direction.nameZh || direction.name : direction.name
    ]));
    updateChrome(dashboard, meta);
    updateMetrics(dashboard);
    updateTodaysPapers(dashboard.todayPapers || dashboard.highScorePapers || []);
    updateRankings(dashboard.hotDirections || []);
    updateEmergingQuestions(dashboard.emergingQuestions || []);
    updateDirectionHeat(directions);
    updateHighScorePapers(dashboard.highScorePapers || []);
    updateDirectionTable(directions);
    updatePaperFilters(facets);
    updatePaperList(papers);
    updateTimeWindowCounts();
    const realPapers = [
      ...(papers.items || []),
      ...(dashboard.todayPapers || []),
      ...(dashboard.highScorePapers || [])
    ].filter((paper) => paper && paper.id);
    realPapers.forEach((paper) => paperCache.set(paper.id, paper));
    defaultPaperId = realPapers[0]?.id || "";
    defaultDirectionId = directions.find((item) => item.paperCount > 0)?.id || directions[0]?.id || "";
    await hydrateSecondaryViews();
    if (defaultPaperId) await renderPaperDetail(defaultPaperId);
  }

  function markLiveReady() {
    document.documentElement.dataset.liveReady = "true";
  }

  function markLiveError(error) {
    document.documentElement.dataset.liveReady = "error";
    const title = $(".live-loading-screen h1");
    const copy = $(".live-loading-screen p");
    if (title) title.textContent = lang === "zh" ? "真实数据加载失败" : "Live data failed to load";
    if (copy) {
      copy.textContent = lang === "zh"
        ? "页面不会展示原型假数据。请稍后刷新，或检查后端 API 状态。"
        : "Prototype placeholder data is hidden. Please refresh later or check the API status.";
    }
    const detail = $(".live-loading-screen .live-loading-detail");
    if (detail) detail.textContent = error instanceof Error ? error.message : String(error || "");
  }

  async function getJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`${url} ${response.status}`);
    return response.json();
  }

  function installPaperListControls() {
    const section = $("#view-papers");
    if (!section) return;

    section.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.name === "time") {
        if (!target.checked) return;
        paperListWindowDays = Number(target.dataset.windowDays || 30);
        await refreshPaperList({ windowDays: paperListWindowDays });
        return;
      }
      if (target.dataset.filterField) {
        togglePaperFilter(target.dataset.filterField, target.dataset.filterValue, target.checked);
        await refreshPaperList();
        return;
      }
      if (target.dataset.scoreFilter) {
        paperListMinScore = Number(target.value || 70);
        await refreshPaperList();
      }
    });

    section.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.dataset.scoreFilter) {
        const value = $("#view-papers [data-score-value]");
        if (value) value.textContent = String(target.value || 70);
        return;
      }
      if (target.dataset.paperSearch) {
        window.clearTimeout(paperSearchTimer);
        paperSearchTimer = window.setTimeout(async () => {
          paperListQuery = target.value.trim();
          await refreshPaperList();
        }, 350);
      }
    });

    section.addEventListener("click", async (event) => {
      const sortOption = event.target.closest?.("#view-papers .sort-options .so");
      if (sortOption) {
        paperListSort = sortOption.dataset.sort || sortFromLabel(sortOption.textContent);
        await refreshPaperList({ sort: paperListSort });
        return;
      }
      if (event.target.closest?.("[data-clear-paper-filters]")) {
        clearPaperFilters();
        await refreshPaperList();
      }
    });
  }

  async function refreshPaperList({ sort = paperListSort, windowDays = paperListWindowDays } = {}) {
    const list = $("#view-papers .paper-list");
    if (list) list.innerHTML = emptyState(lang === "zh" ? "正在按真实数据筛选…" : "Filtering live papers…");
    paperListSort = sort;
    paperListWindowDays = Number(windowDays || 30);
    const [payload, facets] = await Promise.all([
      getJson(paperListUrl()),
      getJson(paperFacetsUrl())
    ]);
    liveState.papers = payload.items || [];
    (payload.items || []).forEach((paper) => paper?.id && paperCache.set(paper.id, paper));
    updatePaperFilters(facets);
    updatePaperList(payload, sort);
  }

  function paperListUrl(extra = {}) {
    const params = new URLSearchParams({
      limit: String(extra.limit || 100),
      sort: extra.sort || paperListSort,
      publishedWithinDays: String(extra.windowDays || paperListWindowDays),
      minScore: String(paperListMinScore)
    });
    addPaperFilterParams(params);
    return `/api/papers?${params.toString()}`;
  }

  function paperFacetsUrl(extra = {}) {
    const params = new URLSearchParams({
      publishedWithinDays: String(extra.windowDays || paperListWindowDays),
      minScore: String(paperListMinScore)
    });
    if (paperListQuery) params.set("q", paperListQuery);
    return `/api/facets?${params.toString()}`;
  }

  function addPaperFilterParams(params) {
    if (paperListQuery) params.set("q", paperListQuery);
    Object.entries(paperListFilters).forEach(([field, values]) => {
      if (values.length) params.set(field, values.join(","));
    });
  }

  function togglePaperFilter(field, value, checked) {
    if (!paperListFilters[field] || !value) return;
    const values = new Set(paperListFilters[field]);
    if (checked) values.add(value);
    else values.delete(value);
    paperListFilters[field] = [...values];
  }

  function clearPaperFilters() {
    Object.keys(paperListFilters).forEach((field) => {
      paperListFilters[field] = [];
    });
    paperListQuery = "";
    paperListMinScore = 70;
  }

  function timeWindowFromLabel(label) {
    const text = String(label || "");
    if (text.includes("Today") || text.includes("今天")) return "1";
    if (text.includes("7")) return "7";
    if (text.includes("30")) return "30";
    if (text.includes("90")) return "90";
    if (text.includes("1 年") || text.includes("1 year") || text.includes("Year")) return "365";
    return "30";
  }

  async function updateTimeWindowCounts() {
    const inputs = $$("#view-papers input[name='time']");
    if (!inputs.length) return;
    await Promise.all(inputs.map(async (input) => {
      const days = Number(input.dataset.windowDays || timeWindowFromLabel(input.closest("label")?.textContent));
      input.dataset.windowDays = String(days);
      const payload = await getJson(`/api/papers?limit=1&sort=recent&publishedWithinDays=${encodeURIComponent(days)}&minScore=${encodeURIComponent(paperListMinScore)}`);
      const count = input.closest("label")?.querySelector(".ct");
      if (count) count.textContent = String(payload.total || 0);
    }));
  }

  function sortFromLabel(label) {
    const text = String(label || "").trim().toLowerCase();
    if (text.includes("hcai") || text.includes("分数") || text.includes("score")) return "score";
    if (text.includes("引用") || text.includes("citation")) return "citations";
    if (text.includes("合作") || text.includes("校") || text.includes("school")) return "institutions";
    if (text.includes("title") || text.includes("标题")) return "title";
    return "recent";
  }

  function updateChrome(dashboard, meta) {
    const date = formatDate(dashboard.lastUpdateAt || dashboard.generatedAt);
    const left = $(".topline .left span");
    if (left) left.innerHTML = `<span class="live-dot"></span>${t.updatedAt} · ${date}`;
    const rightDate = $(".topline .right > span:first-child");
    if (rightDate) rightDate.textContent = date;
    const colophon = $$(".colophon span").at(-1);
    if (colophon) {
      const logs = dashboard.updateLogs || [];
      const last = logs[0];
      const failed = (last && last.sourceResults || []).filter((item) => item.status !== "ok").length;
      colophon.textContent = `${t.updatedAt} · ${date} · ${failed ? t.sourcePartial : t.sourceOk}`;
    }
    updateFooter(dashboard, meta);
    const side = $(".title-row .side.right");
    if (side && meta.update) {
      const label = lang === "zh" ? "数据来源" : "Data sources";
      side.innerHTML = `${label} ·<br>${(meta.update.sources || meta.update.liveSources || ["OpenAlex", "arXiv", "Crossref"]).join(" · ")}`;
    }
  }

  function updateFooter(dashboard, meta) {
    const footer = $("footer");
    if (!footer) return;
    const update = meta.update || {};
    const sources = update.sources || update.liveSources || [];
    const sourceNames = sources.length ? sources : ["OpenAlex", "arXiv", "Crossref"];
    const lastLog = (dashboard.updateLogs || [])[0] || {};
    const sourceResults = lastLog.sourceResults || [];
    const okCount = sourceResults.length
      ? sourceResults.filter((item) => item.status === "ok").length
      : sourceNames.length;
    const next = nextDailyUpdate(update.timezone || "Asia/Shanghai", Number(update.hour ?? 0));
    const lastRun = dashboard.lastUpdateAt || lastLog.finishedAt || dashboard.generatedAt;

    const about = footer.querySelector(".row .col:nth-child(2) p");
    if (about) {
      about.textContent = lang === "zh"
        ? `每天 ${String(update.hour ?? 0).padStart(2, "0")}:00（${update.timezone || "Asia/Shanghai"}）自动从 ${sourceNames.join("、")} 抓取最近 ${update.windowHours || 72} 小时新增或更新的 HCAI 相关论文，并进行去重、分类、打分和内容标签提取。`
        : `Every day at ${String(update.hour ?? 0).padStart(2, "0")}:00 (${update.timezone || "Asia/Shanghai"}), the system pulls HCAI-related papers newly added or updated in the past ${update.windowHours || 72} hours from ${sourceNames.join(", ")} and then deduplicates, classifies, scores, and tags them.`;
    }

    const footerItems = $$(".colophon span", footer);
    if (footerItems[0]) {
      footerItems[0].textContent = lang === "zh"
        ? `下次更新 · ${formatDateStamp(next)} · 北京时间 ${String(update.hour ?? 0).padStart(2, "0")}:00`
        : `NEXT UPDATE · ${formatDateStamp(next)} · ${String(update.hour ?? 0).padStart(2, "0")}:00 BEIJING`;
    }
    if (footerItems[1]) {
      footerItems[1].textContent = lang === "zh"
        ? `数据源 · ${okCount} / ${sourceNames.length} 正常 · 最近更新 · ${formatDate(lastRun)}`
        : `DATA SOURCES · ${okCount}/${sourceNames.length} OK · LAST RUN · ${formatDate(lastRun)}`;
    }
  }

  function updateMetrics(dashboard) {
    const metrics = dashboard.metrics || {};
    const cells = $$(".metrics-strip .metric");
    const data = [
      [t.today, metrics.newToday || 0, t.fetchedAt(formatDate(dashboard.lastUpdateAt))],
      [t.last7, metrics.newLast7Days || 0, t.sourceOk],
      [t.total, metrics.totalPapers || 0, `${t.score} ${metrics.averageHcaiScore || 0}`],
      [t.directions, metrics.activeDirections || 0, `18 primary directions`],
      [t.pending, metrics.pendingReview || 0, `50-69 ${t.score}`],
      [t.updated, shortTime(dashboard.lastUpdateAt || dashboard.generatedAt), formatDate(dashboard.lastUpdateAt || dashboard.generatedAt)]
    ];
    cells.forEach((cell, index) => {
      const item = data[index];
      if (!item) return;
      const lab = $(".lab", cell);
      const num = $(".num", cell);
      const delta = $(".delta", cell);
      if (lab) lab.textContent = item[0];
      if (num) num.textContent = item[1];
      if (delta) delta.textContent = item[2];
    });
  }

  function updateTodaysPapers(papers) {
    const list = $("#todays-papers");
    if (!list) return;
    const displayPapers = localizedPaperSet(papers).slice(0, 8);
    list.innerHTML = displayPapers.length ? displayPapers.map(paperCard).join("") : emptyState();
    const section = list.closest("div");
    const meta = section && $(".sec-head .meta", section);
    if (meta) meta.textContent = t.homeMeta(displayPapers.length || papers.length);
  }

  function updateRankings(directions) {
    const list = $("#ranking-list");
    if (!list) return;
    list.innerHTML = directions.slice(0, 10).map((direction, index) => `
      <div class="ranking-row" onclick="openDirection('${escapeJs(direction.id || "")}')">
        <div class="rank">${String(index + 1).padStart(2, "0")}</div>
        <div><div class="uni">${escapeHtml(directionDisplay(direction))}</div><span class="country">${escapeHtml(directionSubline(direction))}</span></div>
        <div class="trend">${lang === "zh" ? "近 7 日" : "7d"} ${direction.last7Days || 0}</div>
        <div class="count">${direction.paperCount || 0}</div>
      </div>
    `).join("");
  }

  function updateEmergingQuestions(questions) {
    const list = $("#emerging-q");
    if (!list) return;
    list.innerHTML = questions.slice(0, 6).map((question, index) => {
      const directionId = (question.directionIds || [])[0] || defaultDirectionId;
      return `
      <div class="ranking-row" onclick="openDirection('${escapeJs(directionId)}')">
        <div class="rank">${String(index + 1).padStart(2, "0")}</div>
        <div><div class="uni" style="font-size:16px">${escapeHtml(question.name)}</div><span class="country">${escapeHtml((question.directionIds || []).slice(0, 3).map(directionLabel).join(" · "))}</span></div>
        <div class="count" style="color:var(--accent)">${question.count || 0}</div>
      </div>
    `;
    }).join("");
  }

  function updatePaperList(payload, sort = paperListSort) {
    const list = $("#view-papers .paper-list");
    if (!list) return;
    const items = localizedPaperSet(payload.items || []);
    list.innerHTML = items.length ? items.map(paperCard).join("") : emptyState();
    const count = $("#view-papers .sort-row .count");
    if (count) count.textContent = `${t.listCount(payload.total || items.length, items.length)} · ${windowLabel(paperListWindowDays)} · ${sortLabel(sort)}`;
    syncSortUi(sort);
    syncTimeWindowUi(paperListWindowDays);
  }

  function updatePaperFilters(facets = {}) {
    const side = $("#view-papers .fside");
    if (side) side.hidden = true;
    updatePaperFilterBar(facets);
  }

  function timeFilterOption(days, label) {
    return `<label><input type="radio" name="time" data-window-days="${days}" ${Number(paperListWindowDays) === Number(days) ? "checked" : ""} /> <span>${escapeHtml(label)}</span><span class="ct">0</span></label>`;
  }

  function filterDropdown(title, field, items) {
    const selected = paperListFilters[field] || [];
    const rows = items.slice(0, 14).map((item) => {
      const value = item.id || item.name;
      const checked = selected.includes(value) ? "checked" : "";
      return `<label><input type="checkbox" data-filter-field="${escapeHtml(field)}" data-filter-value="${escapeHtml(value)}" ${checked} /> <span>${escapeHtml(facetLabel(field, item))}</span><span class="ct">${item.count || 0}</span></label>`;
    }).join("");
    return `
      <details class="filter-select">
        <summary>${escapeHtml(dropdownSummary(title, field, selected))}</summary>
        <div class="filter-menu">
          ${rows || `<div class="empty-mini">${escapeHtml(lang === "zh" ? "暂无真实可筛选项" : "No real facet values")}</div>`}
        </div>
      </details>
    `;
  }

  function dropdownSummary(title, field, selected) {
    if (!selected.length) return title;
    if (selected.length === 1) return `${title}: ${facetLabel(field, { name: selected[0], id: selected[0] })}`;
    return lang === "zh" ? `${title}: ${selected.length} 项` : `${title}: ${selected.length}`;
  }

  function timeDropdown() {
    return `
      <details class="filter-select">
        <summary>${escapeHtml(lang === "zh" ? `发表时间: ${windowLabel(paperListWindowDays)}` : `Published: ${windowLabel(paperListWindowDays)}`)}</summary>
        <div class="filter-menu">
          ${timeFilterOption(1, lang === "zh" ? "今天发表" : "Published today")}
          ${timeFilterOption(7, lang === "zh" ? "近 7 日发表" : "Published in 7 days")}
          ${timeFilterOption(30, lang === "zh" ? "近 30 日发表" : "Published in 30 days")}
          ${timeFilterOption(90, lang === "zh" ? "近 90 日发表" : "Published in 90 days")}
          ${timeFilterOption(365, lang === "zh" ? "近 1 年发表" : "Published in 1 year")}
        </div>
      </details>
    `;
  }

  function scoreDropdown() {
    return `
      <details class="filter-select score-select">
        <summary>${escapeHtml(`HCAI ≥ ${paperListMinScore}`)}</summary>
        <div class="filter-menu">
          <div class="slider-wrap">
            <input type="range" min="50" max="100" value="${paperListMinScore}" data-score-filter="true" />
            <div class="slider-vals"><span>50</span><span>≥ <strong data-score-value>${paperListMinScore}</strong></span><span>100</span></div>
          </div>
        </div>
      </details>
    `;
  }

  function updatePaperFilterBar(facets = {}) {
    const bar = $("#view-papers .filter-bar");
    if (!bar) return;
    const active = activeFilterLabels();
    bar.innerHTML = `
      <div class="paper-filter-toolbar">
        <div class="search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path></svg>
          <input type="text" data-paper-search="true" value="${escapeHtml(paperListQuery)}" placeholder="${lang === "zh" ? "搜索标题、作者、关键词…" : "Search titles, authors, keywords…"}">
        </div>
        <div class="paper-filter-controls">
          ${timeDropdown()}
          ${scoreDropdown()}
          ${filterDropdown(lang === "zh" ? "研究方向" : "Direction", "direction", facets.directions || [])}
          ${filterDropdown(lang === "zh" ? "研究问题" : "Question", "question", facets.questions || [])}
          ${filterDropdown(lang === "zh" ? "研究方法" : "Method", "method", facets.methods || [])}
          ${filterDropdown(lang === "zh" ? "应用场景" : "Context", "context", facets.contexts || [])}
          ${filterDropdown(lang === "zh" ? "用户群体" : "User Group", "userGroup", facets.userGroups || [])}
          ${filterDropdown(lang === "zh" ? "AI 类型" : "AI Type", "aiType", facets.aiTypes || [])}
          ${filterDropdown(lang === "zh" ? "成果类型" : "Contribution", "contributionType", facets.contributionTypes || [])}
          ${filterDropdown(lang === "zh" ? "数据源" : "Source", "source", facets.sources || [])}
          <button type="button" class="chip" data-clear-paper-filters>${lang === "zh" ? "清除" : "Clear"}</button>
        </div>
        <div class="active-filter-row">
          <span class="flabel">${lang === "zh" ? "当前筛选" : "Active filters"}</span>
          ${active.length ? active.map((label) => `<span class="chip on">${escapeHtml(label)}</span>`).join("") : `<span class="chip on">${lang === "zh" ? "全部真实论文" : "All real papers"}</span>`}
        </div>
      </div>
    `;
    const meta = $("#view-papers > .sec-head .meta");
    if (meta) meta.textContent = lang === "zh"
      ? `${windowLabel(paperListWindowDays)} · HCAI ≥ ${paperListMinScore} · ${facets.total || 0} 篇可筛`
      : `${windowLabel(paperListWindowDays)} · HCAI ≥ ${paperListMinScore} · ${facets.total || 0} filterable`;
  }

  function activeFilterLabels() {
    const labels = [];
    if (paperListQuery) labels.push(`${lang === "zh" ? "搜索" : "Search"}: ${paperListQuery}`);
    Object.entries(paperListFilters).forEach(([field, values]) => {
      values.forEach((value) => labels.push(facetLabel(field, { name: value, id: value })));
    });
    return labels;
  }

  function facetLabel(field, item) {
    if (field === "direction") return lang === "zh" ? item.nameZh || directionLabel(item.id || item.name) : item.name || item.id || "";
    return lang === "zh" ? zhFacetValue(item.name || item.id || "") : item.name || item.id || "";
  }

  function zhFacetValue(value) {
    const labels = {
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
      "Confidence Display": "置信度展示",
      "User Experiment": "用户实验",
      Interview: "访谈",
      Survey: "问卷",
      "Log Analysis": "日志分析",
      Prototype: "原型系统",
      "Field Study": "田野研究",
      Healthcare: "医疗",
      Education: "教育",
      Programming: "编程",
      Writing: "写作",
      Workplace: "工作场景",
      "Mental Health": "心理健康",
      "Decision Support": "决策支持",
      Clinicians: "临床医生",
      Students: "学生",
      Teachers: "教师",
      Developers: "开发者",
      "Creative Professionals": "创意工作者",
      "General Users": "普通用户",
      LLM: "大语言模型",
      "AI Agent": "AI 智能体",
      "Decision Support System": "决策支持系统",
      "Recommendation System": "推荐系统",
      "Generative AI Tool": "生成式 AI 工具",
      "AI System": "AI 系统",
      "Empirical Finding": "实证发现",
      "System Design": "系统设计",
      Framework: "框架",
      "Design Implication": "设计建议"
    };
    return labels[value] || value;
  }

  function updateHighScorePapers(papers) {
    const list = $(".collab-list");
    if (!list) return;
    const items = localizedPaperSet(papers).slice(0, 6);
    list.innerHTML = items.length ? items.map((paper) => {
      const link = paper.url || paper.doi || "";
      const tags = [directionLabel(paper.primaryDirection), ...(paper.secondaryDirections || []).slice(0, 2).map(directionLabel)]
        .filter(Boolean)
        .join(" / ");
      return `
        <div class="collab-item" onclick="openPaperDetail('${escapeJs(paper.id || "")}')">
          <div class="collab-num">${Math.round(paper.hcaiScore || 0)}<small>HCAI</small></div>
          <div>
            <div class="ctitle">${escapeHtml(localizedTitle(paper) || paper.title || "Untitled paper")}</div>
            <div class="cunis">${escapeHtml(tags || "HCAI")}</div>
            <div class="cmeta">${escapeHtml(localizedAbstract(paper) || (lang === "zh" ? "该数据源未提供摘要。" : "No abstract from source."))}</div>
            ${link ? `<a class="tag" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${lang === "zh" ? "源链接" : "Source"}</a>` : ""}
          </div>
          <div class="cdate">${escapeHtml(formatDateOnly(paper.publishedAt || paper.firstSeenAt))}</div>
        </div>
      `;
    }).join("") : emptyState();

    const meta = $(".collab-list")?.previousElementSibling?.querySelector(".meta");
    if (meta) meta.textContent = lang === "zh" ? `真实数据 · ${items.length} 篇` : `Live data · ${items.length} papers`;
  }

  function updateDirectionTable(directions) {
    const tbody = $("#view-universities .uni-table tbody");
    if (!tbody) return;
    tbody.innerHTML = directions.map((direction, index) => {
      const questions = (direction.topQuestions || []).map((item) => `${item.name}(${item.count})`).join(" · ");
      return `
        <tr class="${index < 3 ? "top3" : ""}" onclick="openDirection('${escapeJs(direction.id || "")}')">
          <td class="rank-cell">${String(index + 1).padStart(2, "0")}</td>
          <td class="uname">${escapeHtml(directionDisplay(direction))}<span class="cn">${escapeHtml(directionSubline(direction))}</span></td>
          <td class="mono" style="font-size:11px;color:var(--ink-mute);letter-spacing:.1em">${escapeHtml(direction.cluster || "HCAI")}</td>
          <td class="num">${direction.today || 0}</td>
          <td class="num">${direction.last7Days || 0}</td>
          <td class="num">${direction.last30Days || 0}</td>
          <td class="num">${direction.last365Days || direction.paperCount || 0}</td>
          <td class="num">${(direction.topQuestions || []).length}</td>
          <td class="cr">—<span class="cr-bar"><span class="crf" style="width:0%"></span></span></td>
          <td class="num">${Math.round(direction.averageHcaiScore || 0)}</td>
          <td class="dirs">${escapeHtml(questions || (lang === "zh" ? "暂无真实关联论文" : "No approved papers yet"))}</td>
        </tr>
      `;
    }).join("");
    const hint = $("#view-universities .scroll-hint");
    if (hint) hint.textContent = lang === "zh" ? `真实方向统计 · 共 ${directions.length} 个一级方向` : `Live direction stats · ${directions.length} directions`;
  }

  function updateDirectionHeat(directions) {
    const bars = $(".bars");
    if (!bars) return;
    const max = Math.max(1, ...directions.map((direction) => direction.last30Days || direction.paperCount || 0));
    bars.innerHTML = directions.slice(0, 10).map((direction) => {
      const value = direction.last30Days || direction.paperCount || 0;
      const width = Math.max(4, Math.round(value / max * 100));
      return `
        <div class="bar-row" onclick="openDirection('${escapeJs(direction.id || "")}')">
          <div class="lab">${escapeHtml(directionDisplay(direction))}</div>
          <div class="track"><div class="fill" style="width:${width}%"></div></div>
          <div class="num">${value}</div>
        </div>
      `;
    }).join("");
  }

  function paperCard(paper, index = 0) {
    const authors = (paper.authors || []).slice(0, 6).join("、");
    const institutions = (paper.institutions || []).slice(0, 3).join(" × ");
    const secondary = (paper.secondaryDirections || []).slice(0, 2);
    const title = localizedTitle(paper);
    const excerpt = localizedAbstract(paper);
    const link = paper.url || paper.doi || "";
    const citations = citationCount(paper);
    return `
      <div class="paper" data-paper-id="${escapeHtml(paper.id || "")}" onclick="openPaperDetail('${escapeJs(paper.id || "")}')">
        <div class="num-col">${String(index + 1).padStart(2, "0")}</div>
        <div class="main">
          <h3>${escapeHtml(title || "Untitled paper")}</h3>
          <div class="authors">${escapeHtml(authors || institutions || paper.source || "")}</div>
          <div class="meta-row">
            <span class="tag primary">${escapeHtml(directionLabel(paper.primaryDirection) || "HCAI")}</span>
            ${secondary.map((item) => `<span class="tag">${escapeHtml(directionLabel(item))}</span>`).join("")}
            <span>${escapeHtml([institutions, paper.venue, paper.source].filter(Boolean).join(" · "))}</span>
            <span class="tag">${escapeHtml(citationLabel(citations))}</span>
            ${link ? `<a class="tag" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${lang === "zh" ? "源链接" : "Source"}</a>` : ""}
          </div>
          ${excerpt ? `<div class="excerpt">${escapeHtml(excerpt)}</div>` : ""}
        </div>
        <div class="score-col">
          <div class="score">${Math.round(paper.hcaiScore || 0)}</div>
          <div class="score-lab">${t.score}</div>
        </div>
      </div>
    `;
  }

  function localizedTitle(paper) {
    if (lang !== "zh") return paper.title || "";
    return paper.titleZh || "";
  }

  function localizedAbstract(paper) {
    const abstract = lang === "zh"
      ? paper.abstractZh || ""
      : paper.abstract;
    return String(abstract || "").replace(/\s+/g, " ").trim().slice(0, 160);
  }

  function localizedPaperSet(papers) {
    if (lang !== "zh") return papers;
    return papers.filter((paper) => paper.titleZh);
  }

  function citationCount(paper) {
    return Number(paper?.citationCount ?? paper?.citation_count ?? paper?.citedByCount ?? 0) || 0;
  }

  function citationLabel(count) {
    return lang === "zh" ? `引用 ${count}` : `${count} citations`;
  }

  function directionLabel(id) {
    return directionNames[id] || id || "";
  }

  function emptyState(message = t.noData) {
    return `<div class="paper" style="grid-template-columns:1fr"><div class="main"><h3>${escapeHtml(message)}</h3></div></div>`;
  }

  function syncSortUi(sort) {
    $$("#view-papers .sort-options .so").forEach((option) => {
      option.classList.toggle("on", (option.dataset.sort || sortFromLabel(option.textContent)) === sort);
    });
  }

  function syncTimeWindowUi(days) {
    $$("#view-papers input[name='time']").forEach((input) => {
      input.checked = Number(input.dataset.windowDays || 30) === Number(days);
    });
  }

  function sortLabel(sort) {
    const labels = {
      recent: lang === "zh" ? "按最新排序" : "Newest first",
      score: lang === "zh" ? "按 HCAI 分数排序" : "Sorted by HCAI score",
      citations: lang === "zh" ? "按引用数排序" : "Sorted by citations",
      institutions: lang === "zh" ? "按合作校数排序" : "Sorted by school count",
      title: lang === "zh" ? "按标题排序" : "Sorted by title"
    };
    return labels[sort] || labels.recent;
  }

  function windowLabel(days) {
    const labels = {
      1: lang === "zh" ? "今天发表" : "Published today",
      7: lang === "zh" ? "近 7 日发表" : "Published in 7 days",
      30: lang === "zh" ? "近 30 日发表" : "Published in 30 days",
      90: lang === "zh" ? "近 90 日发表" : "Published in 90 days",
      365: lang === "zh" ? "近 1 年发表" : "Published in 1 year"
    };
    return labels[Number(days)] || labels[30];
  }

  function installDetailRouteGuard() {
    window.openPaperDetail = async function openPaperDetail(id) {
      if (id) await renderPaperDetail(id);
      else if (defaultPaperId) await renderPaperDetail(defaultPaperId);
      if (typeof window.show === "function") window.show("paper-detail");
    };

    window.openDirection = async function openDirection(id, view = "uni-detail") {
      const targetId = id || defaultDirectionId;
      if (!targetId) return;
      const detail = await getDirectionDetail(targetId);
      if (!detail) return;
      activeDirectionId = detail.id || targetId;
      renderDirectionDetailView(detail);
      renderDirectionProfileView(detail);
      if (typeof window.show === "function") window.show(view);
    };

    const originalShow = window.show;
    if (typeof originalShow === "function") {
      window.show = function guardedShow(view) {
        if (view === "paper-detail" && !activePaperId && defaultPaperId) {
          void renderPaperDetail(defaultPaperId);
        }
        if ((view === "uni-detail" || view === "direction") && !activeDirectionId && defaultDirectionId) {
          void window.openDirection(defaultDirectionId, view);
        }
        return originalShow.call(this, view);
      };
    }
  }

  async function hydrateSecondaryViews() {
    const activeDirections = liveState.directions.filter((direction) => direction.paperCount > 0);
    const selected = (activeDirections.length ? activeDirections : liveState.directions).slice(0, 4);
    const details = (await Promise.all(selected.map((direction) => getDirectionDetail(direction.id)))).filter(Boolean);
    const relationDetails = (await Promise.all((activeDirections.length ? activeDirections : liveState.directions)
      .map((direction) => getDirectionDetail(direction.id)))).filter(Boolean);
    liveState.directionDetails = details;
    liveState.relationDetails = relationDetails;
    const primaryDetail = details[0];
    if (primaryDetail) {
      activeDirectionId = primaryDetail.id;
      renderDirectionDetailView(primaryDetail);
      renderDirectionProfileView(primaryDetail);
    }
    renderRelationView(relationDetails);
    renderTrendsView(liveState.directions);
    renderCompareView(details);
    renderWeeklyView(liveState.dashboard, details);
  }

  async function getDirectionDetail(id) {
    if (!id) return null;
    if (directionCache.has(id)) return directionCache.get(id);
    const detail = await getJson(`/api/directions/${encodeURIComponent(id)}`);
    directionCache.set(id, detail);
    return detail;
  }

  function renderDirectionDetailView(detail) {
    const section = $("#view-uni-detail");
    if (!section || !detail) return;
    const papers = detail.recentPapers || detail.representativePapers || [];
    section.innerHTML = `
      <div class="back-link" onclick="show('universities')">${lang === "zh" ? "‹ 返回方向列表" : "‹ Back to directions"}</div>
      <div class="ud-hero">
        <div>
          <div class="country-stamp">${lang === "zh" ? "真实方向详情" : "Live Direction"} · ${escapeHtml(detail.cluster || "HCAI")}</div>
          <h1>${escapeHtml(directionDisplay(detail))}</h1>
          <div class="cn">${escapeHtml(detail.nameZh || detail.name || detail.id)}</div>
          <div class="aliases">${escapeHtml(detail.definition || "")}<br>${escapeHtml((detail.aliases || []).join(" · "))}</div>
        </div>
        <div class="ud-stats">
          <div class="ud-stat"><div class="v acc">${detail.today || 0}</div><div class="l">${lang === "zh" ? "今日入库" : "Indexed Today"}</div></div>
          <div class="ud-stat"><div class="v acc">${detail.last7Days || 0}</div><div class="l">${lang === "zh" ? "近 7 日" : "Last 7 Days"}</div></div>
          <div class="ud-stat"><div class="v">${detail.last30Days || 0}</div><div class="l">${lang === "zh" ? "近 30 日" : "Last 30 Days"}</div></div>
          <div class="ud-stat"><div class="v">${detail.paperCount || 0}</div><div class="l">${lang === "zh" ? "真实论文" : "Papers"}</div></div>
          <div class="ud-stat"><div class="v">${(detail.topQuestions || []).length}</div><div class="l">${lang === "zh" ? "研究问题" : "Questions"}</div></div>
          <div class="ud-stat"><div class="v acc">${Math.round(detail.averageHcaiScore || 0)}</div><div class="l">${lang === "zh" ? "平均 HCAI" : "Avg HCAI"}</div></div>
        </div>
      </div>
      <div class="ud-grid">
        <div>
          <div class="sec-head"><div><span class="kicker">${lang === "zh" ? "真实统计" : "Live stats"}</span><h2>${lang === "zh" ? "研究 <em>问题</em>" : "Research <em>Questions</em>"}</h2></div></div>
          <div class="donut-row">
            <div class="donut"><div class="ctr"><div class="num">${detail.paperCount || 0}</div><div class="lab">${lang === "zh" ? "篇真实论文" : "real papers"}</div></div></div>
            <div class="donut-legend">
              ${listStatRows(detail.topQuestions, "dl")}
            </div>
          </div>
        </div>
        <div>
          <div class="sec-head"><div><span class="kicker">${lang === "zh" ? "内容标签" : "Content tags"}</span><h2>${lang === "zh" ? "高频 <em>内容</em>" : "Frequent <em>Content</em>"}</h2></div></div>
          <table class="partners-tbl">
            ${tableStatRows(lang === "zh" ? "方法" : "Methods", detail.topMethods)}
            ${tableStatRows(lang === "zh" ? "场景" : "Contexts", detail.topContexts)}
          </table>
        </div>
      </div>
      <div class="sec-head" style="margin-top:36px">
        <div><span class="kicker">${lang === "zh" ? "真实论文" : "Real papers"}</span><h2>${lang === "zh" ? "方向 <em>论文</em>" : "Direction <em>Papers</em>"}</h2></div>
        <div class="meta">${lang === "zh" ? "点击进入论文详情" : "Click for detail"}</div>
      </div>
      <div class="paper-list">${papers.length ? papers.map(paperCard).join("") : emptyState()}</div>
    `;
  }

  function renderDirectionProfileView(detail) {
    const section = $("#view-direction");
    if (!section || !detail) return;
    section.innerHTML = `
      <div class="back-link" onclick="show('home')">${lang === "zh" ? "‹ 返回首页" : "‹ Back home"}</div>
      <div class="dir-hero">
        <div>
          <span class="kicker">${lang === "zh" ? "方向画像 · 真实数据" : "Direction profile · Live data"}</span>
          <h1>${escapeHtml(directionDisplay(detail))}</h1>
          <p class="definition">${escapeHtml(detail.definition || "")}</p>
        </div>
        <div class="dir-stats">
          <div class="dir-stat"><div class="v acc">${detail.last30Days || 0}</div><div class="l">${lang === "zh" ? "近 30 日" : "Last 30 Days"}</div></div>
          <div class="dir-stat"><div class="v">${detail.paperCount || 0}</div><div class="l">${lang === "zh" ? "累计真实论文" : "Real Papers"}</div></div>
          <div class="dir-stat"><div class="v">${(detail.topQuestions || []).length}</div><div class="l">${lang === "zh" ? "问题标签" : "Question Tags"}</div></div>
          <div class="dir-stat"><div class="v acc">—</div><div class="l">${lang === "zh" ? "历史增长待积累" : "Growth pending"}</div></div>
          <div class="dir-stat"><div class="v">${Math.round(detail.averageHcaiScore || 0)}</div><div class="l">${lang === "zh" ? "平均 HCAI 分" : "Avg HCAI"}</div></div>
          <div class="dir-stat"><div class="v acc">${(detail.relatedDirections || []).length}</div><div class="l">${lang === "zh" ? "相关方向" : "Related"}</div></div>
        </div>
      </div>
      <div class="dir-grid">
        <div class="dir-tops">
          <div class="sec-head"><div><span class="kicker">${lang === "zh" ? "代表论文" : "Representative papers"}</span><h2>${lang === "zh" ? "方向 <em>代表作</em>" : "Representative <em>Papers</em>"}</h2></div></div>
          <table><tbody>${(detail.representativePapers || []).map((paper, index) => `
            <tr onclick="openPaperDetail('${escapeJs(paper.id || "")}')"><td class="r">${String(index + 1).padStart(2, "0")}</td><td class="u">${escapeHtml(localizedTitle(paper) || paper.title || "")}</td><td class="pc">${escapeHtml(paper.source || "")}</td><td class="n">${Math.round(paper.hcaiScore || 0)}</td></tr>
          `).join("") || `<tr><td>${t.noData}</td></tr>`}</tbody></table>
        </div>
        <div>
          <div class="sec-head"><div><span class="kicker">${lang === "zh" ? "相邻方向" : "Adjacent directions"}</span><h2>${lang === "zh" ? "相邻 <em>方向</em>" : "Related <em>Directions</em>"}</h2></div></div>
          <div class="adjacent-list">${(detail.relatedDirections || []).map((item) => `
            <div class="adj-row" onclick="openDirection('${escapeJs(item.direction?.id || item.name || "")}', 'direction')"><div class="an">${escapeHtml(directionLabel(item.direction?.id || item.name))}</div><div class="av">${item.count || 0}<small>${lang === "zh" ? "共现次数" : "co-occurrences"}</small></div></div>
          `).join("") || emptyInline(lang === "zh" ? "暂无真实共现关系" : "No real co-occurrence yet")}</div>
          <div class="sec-head" style="margin-top:36px"><div><span class="kicker">${lang === "zh" ? "相关子主题" : "Subtopics"}</span><h2>${lang === "zh" ? "相关 <em>子主题</em>" : "Related <em>Subtopics</em>"}</h2></div></div>
          <div class="subtopics-chips">${(detail.topQuestions || []).map((item) => `<span class="st-chip">${escapeHtml(item.name)}<span class="ct">${item.count || 0}</span></span>`).join("") || emptyInline(lang === "zh" ? "暂无真实问题标签" : "No question tags yet")}</div>
        </div>
      </div>
    `;
  }

  function renderRelationView(details) {
    const section = $("#view-collab");
    if (!section) return;
    const graph = buildRelationGraph(details);
    const strongest = graph.edges[0];
    const central = graph.nodes.slice().sort((a, b) => (b.degree || 0) - (a.degree || 0) || (b.paperCount || 0) - (a.paperCount || 0))[0];
    const isolated = graph.nodes.filter((node) => !node.degree).length;
    section.innerHTML = `
      <div class="back-link" onclick="show('home')">${lang === "zh" ? "‹ 返回首页" : "‹ Back home"}</div>
      <div class="p2-hero">
        <span class="kicker">${lang === "zh" ? "方向关系 · 真实共现" : "Direction relations · Real co-occurrence"}</span>
        <h2>${lang === "zh" ? "方向 <em>关系图</em>" : "Direction <em>Map</em>"}</h2>
        <p class="lead">${lang === "zh" ? `${graph.nodes.length} 个真实活跃方向 · ${graph.edges.length} 条真实共现关系 · 基于已通过论文的多方向标签` : `${graph.nodes.length} active directions · ${graph.edges.length} real co-occurrence links · based on approved paper tags`}</p>
      </div>
      <div class="net-wrap">
        <div class="net-canvas">
          ${renderRelationSvg(graph)}
        </div>
        <div class="net-side">
          <div class="panel">
            <h4>${lang === "zh" ? "图例" : "Legend"}</h4>
            <div class="legend-item"><span class="sw us"></span>${lang === "zh" ? "核心方向" : "Core directions"}</div>
            <div class="legend-item"><span class="sw eu"></span>${lang === "zh" ? "方法 / 智能体方向" : "Method / agent directions"}</div>
            <div class="legend-item"><span class="sw asia"></span>${lang === "zh" ? "应用 / 社会方向" : "Applied / society directions"}</div>
            <div class="legend-item" style="margin-top:8px"><span class="line-sw"></span>${lang === "zh" ? "同簇共现" : "Within-cluster"}</div>
            <div class="legend-item"><span class="line-sw cross"></span>${lang === "zh" ? "跨簇共现" : "Cross-cluster"}</div>
            <div class="legend-item" style="margin-top:8px;font-style:italic;color:var(--ink-mute);font-size:11.5px">${lang === "zh" ? "节点大小 · 真实论文数" : "Node size · real paper count"}</div>
          </div>
          <div class="panel">
            <h4>${lang === "zh" ? "关系洞察" : "Relation Insights"}</h4>
            <div class="insight-row"><span class="il">${lang === "zh" ? "中心度最高" : "Most central"}</span><span class="iv acc">${escapeHtml(central ? `${directionDisplay(central)} · ${central.degree || 0}` : "-")}</span></div>
            <div class="insight-row"><span class="il">${lang === "zh" ? "最强关系对" : "Strongest pair"}</span><span class="iv">${escapeHtml(strongest ? `${directionDisplay(strongest.source)} × ${directionDisplay(strongest.target)} · ${strongest.count}` : "-")}</span></div>
            <div class="insight-row"><span class="il">${lang === "zh" ? "活跃方向" : "Active nodes"}</span><span class="iv acc">${graph.nodes.length}</span></div>
            <div class="insight-row"><span class="il">${lang === "zh" ? "真实连线" : "Real links"}</span><span class="iv">${graph.edges.length}</span></div>
            <div class="insight-row"><span class="il">${lang === "zh" ? "孤立方向" : "Isolated"}</span><span class="iv">${isolated}</span></div>
          </div>
        </div>
      </div>
      <div class="sec-head">
        <div><span class="kicker">${lang === "zh" ? "高频方向共现" : "Top co-occurrences"}</span><h2>${lang === "zh" ? "高频 <em>共现对</em>" : "Frequent <em>Pairs</em>"}</h2></div>
      </div>
      <table class="uni-table"><thead><tr><th>#</th><th>${lang === "zh" ? "源方向" : "Source"}</th><th>${lang === "zh" ? "相关方向" : "Related"}</th><th class="num">${lang === "zh" ? "共现次数" : "Count"}</th></tr></thead><tbody>
        ${graph.edges.length ? graph.edges.slice(0, 12).map((edge, index) => `<tr onclick="openDirection('${escapeJs(edge.target.id || "")}', 'direction')"><td class="rank-cell">${String(index + 1).padStart(2, "0")}</td><td class="uname">${escapeHtml(directionDisplay(edge.source))}</td><td class="dirs">${escapeHtml(directionDisplay(edge.target))}</td><td class="num">${edge.count}</td></tr>`).join("") : `<tr><td colspan="4">${t.noData}</td></tr>`}
      </tbody></table>
    `;
  }

  function buildRelationGraph(details = []) {
    const nodeMap = new Map(details.map((detail) => [detail.id, { ...detail, degree: 0 }]));
    const edgeMap = new Map();
    details.forEach((detail) => {
      (detail.relatedDirections || []).forEach((item) => {
        const targetId = item.direction?.id || item.name;
        if (!targetId || targetId === detail.id || !nodeMap.has(targetId)) return;
        const ids = [detail.id, targetId].sort();
        const key = ids.join("::");
        const count = Number(item.count || 0);
        const existing = edgeMap.get(key);
        if (!existing || count > existing.count) {
          edgeMap.set(key, {
            source: nodeMap.get(ids[0]),
            target: nodeMap.get(ids[1]),
            count
          });
        }
      });
    });
    const edges = [...edgeMap.values()].sort((a, b) => b.count - a.count);
    edges.forEach((edge) => {
      edge.source.degree = (edge.source.degree || 0) + 1;
      edge.target.degree = (edge.target.degree || 0) + 1;
    });
    const nodes = [...nodeMap.values()]
      .sort((a, b) => (b.paperCount || 0) - (a.paperCount || 0) || directionDisplay(a).localeCompare(directionDisplay(b)))
      .slice(0, 18);
    const visible = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      edges: edges.filter((edge) => visible.has(edge.source.id) && visible.has(edge.target.id)).slice(0, 28)
    };
  }

  function renderRelationSvg(graph) {
    const nodes = graph.nodes.map((node, index) => ({ ...node, ...relationPosition(node, index, graph.nodes.length) }));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const maxCount = Math.max(1, ...graph.edges.map((edge) => edge.count || 0));
    const maxPapers = Math.max(1, ...nodes.map((node) => node.paperCount || 0));
    const edges = graph.edges.map((edge) => ({
      ...edge,
      source: byId.get(edge.source.id),
      target: byId.get(edge.target.id)
    })).filter((edge) => edge.source && edge.target);
    return `
      <svg viewBox="0 0 970 540" xmlns="http://www.w3.org/2000/svg">
        <text class="axis-label" x="40" y="40">${lang === "zh" ? "核心方向 · CORE" : "CORE"}</text>
        <text class="axis-label" x="500" y="40" text-anchor="middle">${lang === "zh" ? "方法 / 智能体 · METHOD" : "METHOD / AGENT"}</text>
        <text class="axis-label" x="900" y="40" text-anchor="end">${lang === "zh" ? "应用 / 社会 · APPLIED" : "APPLIED / SOCIETY"}</text>
        <line x1="370" y1="20" x2="370" y2="510" stroke="var(--rule-soft)" stroke-dasharray="3 4"/>
        <line x1="730" y1="20" x2="730" y2="510" stroke="var(--rule-soft)" stroke-dasharray="3 4"/>
        ${edges.map((edge) => {
          const cls = edge.source.cluster === edge.target.cluster ? edgeClass(edge.count, maxCount) : `${edgeClass(edge.count, maxCount)} cross`;
          return `<line class="edge ${cls}" x1="${edge.source.x}" y1="${edge.source.y}" x2="${edge.target.x}" y2="${edge.target.y}"><title>${escapeHtml(directionDisplay(edge.source))} × ${escapeHtml(directionDisplay(edge.target))}: ${edge.count}</title></line>`;
        }).join("")}
        ${nodes.map((node) => {
          const radius = 11 + Math.round(((node.paperCount || 0) / maxPapers) * 17);
          const labelY = node.y + radius + 16;
          return `<g class="node ${clusterClass(node.cluster)}" onclick="openDirection('${escapeJs(node.id)}', 'direction')"><circle cx="${node.x}" cy="${node.y}" r="${radius}"><title>${escapeHtml(directionDisplay(node))} · ${node.paperCount || 0}</title></circle><text x="${node.x}" y="${labelY}" text-anchor="middle">${escapeHtml(shortDirectionLabel(node))}</text></g>`;
        }).join("")}
      </svg>
    `;
  }

  function relationPosition(node, index, total) {
    const columns = {
      core: { x: 220, ys: [120, 210, 300, 390, 470] },
      method: { x: 500, ys: [90, 190, 300, 410] },
      agent: { x: 650, ys: [140, 260, 380] },
      society: { x: 790, ys: [120, 240, 360, 460] },
      applied: { x: 875, ys: [120, 220, 320, 420, 485] }
    };
    const bucket = columns[node.cluster] || columns.method;
    const sameClusterIndex = liveState.relationDetails
      ? liveState.relationDetails.filter((detail) => detail.cluster === node.cluster && (detail.paperCount || 0) > 0).findIndex((detail) => detail.id === node.id)
      : index;
    const offset = Math.max(0, sameClusterIndex);
    const xJitter = (offset % 2) * 34 - 17;
    return {
      x: bucket.x + xJitter,
      y: bucket.ys[offset % bucket.ys.length]
    };
  }

  function clusterClass(cluster) {
    if (cluster === "core") return "us";
    if (cluster === "applied" || cluster === "society") return "asia";
    return "eu";
  }

  function edgeClass(count, maxCount) {
    const ratio = count / Math.max(1, maxCount);
    if (ratio >= 0.75) return "thickest";
    if (ratio >= 0.45) return "thicker";
    if (ratio >= 0.2) return "thick";
    return "";
  }

  function shortDirectionLabel(direction) {
    const label = directionDisplay(direction);
    const shortLabels = {
      "AI-assisted Decision Making": "AI-assisted Decision",
      "Multi-Agent Collaboration": "Multi-Agent Collab.",
      "Human-AI Collaboration": "Human-AI Collab.",
      "Human-AI Interaction": "Human-AI Interaction",
      "Generative AI Tools": "Generative AI Tools",
      "AI-mediated Communication": "AI-mediated Comm."
    };
    return shortLabels[label] || label;
  }

  function renderTrendsView(directions) {
    const section = $("#view-trends");
    if (!section) return;
    section.innerHTML = `
      <div class="back-link" onclick="show('home')">${lang === "zh" ? "‹ 返回首页" : "‹ Back home"}</div>
      <div class="sec-head"><div><span class="kicker">${lang === "zh" ? "研究趋势 · 当前真实窗口" : "Trends · Current real window"}</span><h2>${lang === "zh" ? "研究 <em>趋势</em>" : "Research <em>Trends</em>"}</h2></div><div class="meta">${lang === "zh" ? "历史增长率等待后续每日抓取积累" : "Growth needs historical snapshots"}</div></div>
      <table class="uni-table"><thead><tr><th>#</th><th>${lang === "zh" ? "方向" : "Direction"}</th><th class="num">${lang === "zh" ? "今日入库" : "Indexed Today"}</th><th class="num">${lang === "zh" ? "近 7 日入库" : "7d Indexed"}</th><th class="num">${lang === "zh" ? "近 30 日发表" : "30d Published"}</th><th class="num">${lang === "zh" ? "增长" : "Growth"}</th><th>${lang === "zh" ? "高频问题" : "Top questions"}</th></tr></thead><tbody>
        ${directions.map((direction, index) => `<tr onclick="openDirection('${escapeJs(direction.id || "")}', 'direction')"><td class="rank-cell">${String(index + 1).padStart(2, "0")}</td><td class="uname">${escapeHtml(directionDisplay(direction))}<span class="cn">${escapeHtml(directionSubline(direction))}</span></td><td class="num">${direction.today || 0}</td><td class="num">${direction.last7Days || 0}</td><td class="num">${direction.last30Days || 0}</td><td class="cr">—</td><td class="dirs">${escapeHtml((direction.topQuestions || []).map((item) => item.name).join(" · ") || "-")}</td></tr>`).join("")}
      </tbody></table>
    `;
  }

  function renderCompareView(details) {
    const section = $("#view-compare");
    if (!section) return;
    const selected = details.slice(0, 4);
    section.innerHTML = `
      <div class="back-link" onclick="show('home')">${lang === "zh" ? "‹ 返回首页" : "‹ Back home"}</div>
      <div class="sec-head"><div><span class="kicker">${lang === "zh" ? "方向对比 · 真实统计" : "Direction comparison · Live stats"}</span><h2>${lang === "zh" ? "方向 <em>对比</em>" : "Direction <em>Compare</em>"}</h2></div></div>
      <div class="compare-grid" style="grid-template-columns:160px repeat(${Math.max(1, selected.length)},1fr)">
        <div class="cmp-cell row-label">${lang === "zh" ? "维度" : "Metric"}</div>
        ${selected.map((detail) => `<div class="cmp-cell dir-name">${escapeHtml(directionDisplay(detail))}</div>`).join("")}
        ${compareRow(lang === "zh" ? "真实论文数" : "Papers", selected.map((detail) => detail.paperCount || 0))}
        ${compareRow(lang === "zh" ? "近 30 日" : "Last 30 Days", selected.map((detail) => detail.last30Days || 0))}
        ${compareRow(lang === "zh" ? "平均 HCAI" : "Avg HCAI", selected.map((detail) => Math.round(detail.averageHcaiScore || 0)))}
        ${compareRow(lang === "zh" ? "高频研究问题" : "Top Questions", selected.map((detail) => (detail.topQuestions || []).map((item) => item.name).slice(0, 4).join(" · ") || "-"))}
        ${compareRow(lang === "zh" ? "常见方法" : "Methods", selected.map((detail) => (detail.topMethods || []).map((item) => item.name).slice(0, 4).join(" · ") || "-"))}
        ${compareRow(lang === "zh" ? "常见场景" : "Contexts", selected.map((detail) => (detail.topContexts || []).map((item) => item.name).slice(0, 4).join(" · ") || "-"))}
      </div>
    `;
  }

  function renderWeeklyView(dashboard, details) {
    const section = $("#view-weekly");
    if (!section || !dashboard) return;
    const papers = dashboard.highScorePapers || [];
    section.innerHTML = `
      <div class="back-link" onclick="show('home')">${lang === "zh" ? "‹ 返回首页" : "‹ Back home"}</div>
      <div class="weekly-hero">
        <span class="issue-no">${lang === "zh" ? "真实抓取摘要" : "Live Update Brief"} · ${escapeHtml(formatDate(dashboard.lastUpdateAt || dashboard.generatedAt))}</span>
        <h1>${lang === "zh" ? "本次 <em>HCAI</em> 研究更新" : "Current <em>HCAI</em> Update"}</h1>
        <p class="lead">${lang === "zh" ? `当前用户端只展示 ${dashboard.metrics?.totalPapers || 0} 篇已通过真实论文，待审池 ${dashboard.metrics?.pendingReview || 0} 篇。没有真实来源或低置信度的条目不会进入用户端。` : `The public site shows ${dashboard.metrics?.totalPapers || 0} approved real papers and keeps ${dashboard.metrics?.pendingReview || 0} papers in review.`}</p>
      </div>
      <div class="weekly-strip">
        <div class="ws"><div class="l">${lang === "zh" ? "今日入库" : "Indexed Today"}</div><div class="v acc">${dashboard.metrics?.newToday || 0}</div><div class="d">${lang === "zh" ? "真实来源入库" : "real sources indexed"}</div></div>
        <div class="ws"><div class="l">${lang === "zh" ? "近 7 日" : "Last 7 Days"}</div><div class="v">${dashboard.metrics?.newLast7Days || 0}</div><div class="d">${lang === "zh" ? "首次发现" : "first seen"}</div></div>
        <div class="ws"><div class="l">${lang === "zh" ? "活跃方向" : "Active Directions"}</div><div class="v">${dashboard.metrics?.activeDirections || 0}</div><div class="d">${lang === "zh" ? "有已通过论文" : "with approved papers"}</div></div>
        <div class="ws"><div class="l">${lang === "zh" ? "平均分" : "Avg Score"}</div><div class="v acc">${dashboard.metrics?.averageHcaiScore || 0}</div><div class="d">HCAI</div></div>
      </div>
      <div class="weekly-body">
        <div class="weekly-section"><h3>${lang === "zh" ? "本次重要论文" : "Important Papers"}</h3>
          ${papers.length ? papers.map((paper, index) => `<div class="weekly-headline" onclick="openPaperDetail('${escapeJs(paper.id || "")}')"><div class="wh-num">${String(index + 1).padStart(2, "0")}</div><div><div class="wh-t">${escapeHtml(localizedTitle(paper) || paper.title || "")}</div><div class="wh-m">${escapeHtml([paper.source, paper.venue, `HCAI ${Math.round(paper.hcaiScore || 0)}`].filter(Boolean).join(" · "))}</div><div class="wh-c">${escapeHtml(localizedAbstract(paper) || (lang === "zh" ? "该数据源未提供摘要。" : "No abstract from source."))}</div></div></div>`).join("") : emptyInline(t.noData)}
        </div>
        <div class="weekly-section"><h3>${lang === "zh" ? "本次活跃方向" : "Active Directions"}</h3><div class="weekly-mini"><ul>${details.map((detail) => `<li><span class="ln">${escapeHtml(directionDisplay(detail))}</span><span class="lv">${detail.paperCount || 0}</span></li>`).join("")}</ul></div></div>
      </div>
      <div class="weekly-foot">${lang === "zh" ? "说明：本页为真实抓取数据摘要，不包含原型占位论文。" : "Note: this brief is generated from live fetched data only."}</div>
    `;
  }

  function clearStaticPaperDetail() {
    const section = $("#view-paper-detail");
    if (!section) return;
    section.innerHTML = `
      <div class="back-link" onclick="show('papers')">${lang === "zh" ? "‹ 返回论文列表" : "‹ Back to papers"}</div>
      <div class="pd-grid">
        <article>
          <span class="kicker">${lang === "zh" ? "真实论文详情" : "Real Paper Detail"}</span>
          <h1 class="pd-title">${lang === "zh" ? "正在加载真实论文数据" : "Loading real paper data"}</h1>
          <p class="pd-abstract">${lang === "zh" ? "本站论文详情只显示来自 arXiv、Crossref、OpenAlex 等真实数据源的论文。没有真实来源链接的条目不会进入用户端详情页。" : "This page only renders papers from real data sources with traceable links."}</p>
        </article>
        <aside>
          <div class="score-bigbox">
            <div class="lab">HCAI</div>
            <div class="big">--<small>/100</small></div>
            <div class="desc">${lang === "zh" ? "等待真实数据" : "Waiting for real data"}</div>
          </div>
        </aside>
      </div>
    `;
  }

  async function renderPaperDetail(id) {
    const section = $("#view-paper-detail");
    if (!section || !id) return;
    const paper = paperCache.get(id) || await getJson(`/api/papers/${encodeURIComponent(id)}`);
    if (!paper || !paper.id) return;
    paperCache.set(paper.id, paper);
    activePaperId = paper.id;

    const title = localizedTitle(paper) || paper.title || "";
    const originalTitle = paper.title && paper.title !== title ? paper.title : "";
    const originalAbstract = String(paper.abstract || "").trim();
    const zhSummary = lang === "zh" ? String(paper.abstractZh || "").trim() : "";
    const authors = (paper.authors || []).join("、") || "-";
    const institutions = (paper.institutions || []).filter(Boolean);
    const directions = [paper.primaryDirection, ...(paper.secondaryDirections || [])].filter(Boolean);
    const sourceMeta = [paper.source, paper.venue, formatDateOnly(paper.publishedAt), paper.doi].filter(Boolean).join(" · ");
    const link = paper.url || paper.doi || "";
    const citations = citationCount(paper);

    section.innerHTML = `
      <div class="back-link" onclick="show('papers')">${lang === "zh" ? "‹ 返回论文列表" : "‹ Back to papers"}</div>
      <div class="pd-grid">
        <article>
          <span class="kicker">${lang === "zh" ? "真实论文详情" : "Real Paper Detail"} · ${escapeHtml(directionLabel(paper.primaryDirection) || "HCAI")}</span>
          <h1 class="pd-title">${escapeHtml(title)}</h1>
          ${originalTitle ? `<p class="pd-byline"><strong>${lang === "zh" ? "原始标题" : "Original title"}：</strong>${escapeHtml(originalTitle)}</p>` : ""}
          <p class="pd-byline">${escapeHtml(authors)}${sourceMeta ? ` · ${escapeHtml(sourceMeta)}` : ""}</p>
          ${institutions.length ? `<div class="pd-affil">${institutions.slice(0, 6).map((item, index) => `<div><span class="num">${index + 1}</span>${escapeHtml(item)}</div>`).join("")}</div>` : ""}
          <div class="pd-tags">
            ${directions.map((item, index) => `<span class="tag ${index === 0 ? "primary" : ""}">${escapeHtml(directionLabel(item))}</span>`).join("")}
            <span class="tag hi-score">${escapeHtml(t.score)} ${Math.round(paper.hcaiScore || 0)}</span>
            <span class="tag">${escapeHtml(citationLabel(citations))}</span>
            <span class="tag">${escapeHtml(paper.reviewStatus || "")}</span>
          </div>

          ${zhSummary ? `<div class="pd-block"><h3>中文导读 · 自动生成</h3><p class="pd-abstract">${escapeHtml(zhSummary)}</p></div>` : ""}

          <div class="pd-block">
            <h3>${lang === "zh" ? "原始摘要 · 来自论文数据源" : "Original Abstract · From Source"}</h3>
            <p class="pd-abstract">${escapeHtml(originalAbstract || (lang === "zh" ? "该数据源未提供摘要。" : "No abstract was provided by the source."))}</p>
          </div>

          <div class="pd-block">
            <h3>${lang === "zh" ? "分类理由 · 自动判定" : "Classification Reason"}</h3>
            <p class="reason">${escapeHtml(paper.classificationReason || "")}</p>
          </div>

          ${link ? `<div class="pd-block"><h3>${lang === "zh" ? "原文链接" : "Source Link"}</h3><p class="reason"><a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link)}</a></p></div>` : ""}
        </article>

        <aside>
          <div class="score-bigbox">
            <div class="lab">HCAI</div>
            <div class="big">${Math.round(paper.hcaiScore || 0)}<small>/100</small></div>
            <div class="desc">${escapeHtml([paper.confidence, paper.reviewStatus, paper.source].filter(Boolean).join(" · "))}</div>
          </div>
          ${asideList(lang === "zh" ? "研究问题" : "Research Questions", paper.researchQuestions)}
          ${asideList(lang === "zh" ? "研究方法" : "Methods", paper.researchMethods)}
          ${asideList(lang === "zh" ? "应用场景" : "Contexts", paper.applicationContexts)}
          ${asideList(lang === "zh" ? "用户群体" : "User Groups", paper.userGroups)}
          ${asideList(lang === "zh" ? "AI 系统类型" : "AI System Types", paper.aiSystemTypes)}
          ${asideList(lang === "zh" ? "评价指标" : "Metrics", paper.evaluationMetrics)}
          <div class="aside-block">
            <div class="lab">${lang === "zh" ? "数据质量" : "Data Quality"}</div>
            <ul style="list-style:none">
              <li>${lang === "zh" ? "质量分" : "Score"}：${escapeHtml(paper.dataQuality?.score ?? "-")}</li>
              <li>${lang === "zh" ? "缺失字段" : "Missing"}：${escapeHtml((paper.dataQuality?.missingFields || []).join("、") || "-")}</li>
            </ul>
          </div>
        </aside>
      </div>
    `;
  }

  function asideList(label, values = []) {
    const items = (values || []).filter(Boolean);
    if (!items.length) return "";
    return `
      <div class="aside-block">
        <div class="lab">${escapeHtml(label)}</div>
        <ul style="list-style:none">
          ${items.map((item) => `<li style="font-family:var(--body);font-size:14px;color:var(--ink);padding:6px 0;line-height:1.45">${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  function directionDisplay(direction) {
    if (!direction) return "";
    return lang === "zh" ? direction.nameZh || direction.name || direction.id : direction.name || direction.nameZh || direction.id;
  }

  function directionSubline(direction) {
    if (!direction) return "";
    const name = lang === "zh" ? direction.name || direction.id : direction.nameZh || direction.cluster || "";
    return [name, direction.cluster].filter(Boolean).join(" · ");
  }

  function listStatRows(items = [], className = "dl") {
    const rows = (items || []).slice(0, 8);
    if (!rows.length) return emptyInline(t.noData);
    return rows.map((item) => `<div class="${className}">${escapeHtml(item.name)} <span class="pct">${item.count || 0}</span></div>`).join("");
  }

  function tableStatRows(label, items = []) {
    return (items || []).slice(0, 5).map((item) => `
      <tr>
        <td class="u">${escapeHtml(item.name)}</td>
        <td class="d">${escapeHtml(label)}</td>
        <td class="n">${item.count || 0}</td>
      </tr>
    `).join("");
  }

  function compareRow(label, values) {
    return `
      <div class="cmp-cell row-label">${escapeHtml(label)}</div>
      ${values.map((value) => `<div class="cmp-cell"><p class="pmini">${escapeHtml(value)}</p></div>`).join("")}
    `;
  }

  function emptyInline(message) {
    return `<div style="font-family:var(--body);font-size:14px;color:var(--ink-mute);padding:14px 0">${escapeHtml(message)}</div>`;
  }

  function formatDate(value) {
    const date = value ? new Date(value) : new Date();
    return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function shortTime(value) {
    const date = value ? new Date(value) : new Date();
    return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function formatDateOnly(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  function formatDateStamp(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const data = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${data.year}·${data.month}·${data.day}`;
  }

  function nextDailyUpdate(timezone, hour) {
    const now = new Date();
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).formatToParts(now).map((part) => [part.type, part.value]));
    const localAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const target = new Date(localAsUtc);
    target.setUTCHours(hour, 0, 0, 0);
    if (target <= new Date(localAsUtc)) target.setUTCDate(target.getUTCDate() + 1);
    return target;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeJs(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }
})();
