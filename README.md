# HCAI Research Map

面向 HCAI / Human-AI Interaction / Human-Centered AI 的研究方向追踪系统。当前版本包含可上线网站所需的静态原型托管、REST API、文件型数据仓库、真实学术数据源抓取、HCAI 打分、方向归类、待审池、更新日志和每日定时更新任务。

## 运行

npm install
npm run dev

## 真实数据运行

复制 `.env.example` 为 `.env` 后打开实时抓取：

```bash
NODE_ENV=production
PORT=3000
DATA_FILE=./data/db.json
ENABLE_SCHEDULER=true
ENABLE_LIVE_FETCH=true
UPDATE_ON_START=true
LIVE_SOURCES=openalex,arxiv,crossref,semanticscholar
ADMIN_API_TOKEN=your-strong-token
OPENALEX_API_KEY=your-openalex-key
OPENALEX_EMAIL=you@example.com
CROSSREF_EMAIL=you@example.com
SEMANTIC_SCHOLAR_API_KEY=
```

启动后会：

1. 托管中文首页 `/` 和英文首页 `/en`；
2. 前端自动从 `/api/dashboard`、`/api/papers`、`/api/meta` 替换为真实数据；
3. 如果 `UPDATE_ON_START=true`，启动后立即抓取一次；
4. 如果 `ENABLE_SCHEDULER=true`，每天按 `UPDATE_TIMEZONE` / `UPDATE_HOUR` 自动更新；
5. HCAI 分数 ≥ 70 自动进入主看板，50–69 进入待审池。

OpenAlex 官方 API 当前要求 API key；arXiv 和 Crossref 可以作为无需 key 的基础数据源，Semantic Scholar 可选配置 API key 以提高额度。

## 主要 API

- `GET /api/dashboard` 首页指标、今日新增、热门方向、新兴问题
- `GET /api/papers` 论文列表，支持方向、问题、方法、场景、用户群体、AI 类型、分数、时间、排序筛选
- `GET /api/papers/:id` 论文详情
- `GET /api/directions` 研究方向列表
- `GET /api/directions/:id` 研究方向详情
- `GET /api/review/papers` 待审池
- `PATCH /api/review/papers/:id` 审核或修改论文，需 `Authorization: Bearer <ADMIN_API_TOKEN>`
- `POST /api/jobs/update` 手动触发更新，需管理员 token
- `GET /api/update-logs` 更新日志
- `GET /api/search?q=trust` 全局搜索

## 数据源

实时抓取当前支持：

- OpenAlex Works API：论文、作者、机构、期刊/会议、DOI、发布日期；
- arXiv Atom API：预印本标题、摘要、作者、发布时间、更新时间；
- Crossref Works API：出版物元数据、DOI、期刊/会议、发布日期；
- Semantic Scholar Graph API：标题、摘要、作者、venue、年份、URL。

每次更新会按 DOI 或标题去重，统一进入规则分类器，保存每个源的抓取状态到 `/api/update-logs`。

## 部署

```bash
docker build -t hcai-research-map .
docker run -p 3000:3000 \
  -v "$PWD/data:/app/data" \
  -e NODE_ENV=production \
  -e ENABLE_LIVE_FETCH=true \
  -e UPDATE_ON_START=true \
  -e ADMIN_API_TOKEN=your-strong-token \
  -e OPENALEX_API_KEY=your-openalex-key \
  -e OPENALEX_EMAIL=you@example.com \
  -e CROSSREF_EMAIL=you@example.com \
  hcai-research-map
```

生产环境建议把 `data/db.json` 挂载到持久化卷。后续如果流量或并发写入变大，可以把 `src/backend/store` 替换为 PostgreSQL/Prisma 实现，API 和业务服务无需大改。
