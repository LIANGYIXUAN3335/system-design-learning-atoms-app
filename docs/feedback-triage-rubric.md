# Feedback triage rubric（P1 feedback-driven content update cron 的路由标准）

> 📍 **体系导航**：本文件只决定“用户 feedback 应该怎么处理、交给哪个 flow、用什么模型档位”。这是 P1 反馈驱动内容更新线；当前 P0 是 rubric-driven backfill cron。卡片质量本身仍以 `docs/card-quality-rubric.md` 为唯一裁判；执行流程仍走 `docs/REGEN_FLOW.md`、`scripts/ENRICH_SPEC.md`、`scripts/AUTHORING_SPEC.md`。

## 0. Goal

Content update cron 的目标不是“用户一写反馈就自动改题库”，而是把高信号反馈整理成可审核的候选更新：

```
feedback export -> triage -> route -> candidates -> quality gates -> human accept
```

默认产物是 report / candidate，不是直接 mutation。

## 1. Inputs

每次 triage 至少读取：

- `buildFeedbackExport` 输出：`id`, `sub`, `atomType`, `q`, `grade`, `flags`, `term`, `note`
- 源 card JSON：`scenario`, `options`, `answer`, `why`, `why_en`, rich option fields, `diagram`, `table`, `codeSample`
- 小上下文：同 deck 邻近卡、同 tag 少量卡、当前 quality rubric

不要默认读取整套 6000 张卡；不要读取无关学习状态。

## 2. Feedback Classes

| 信号 | 例子 | 默认处理 |
|---|---|---|
| `wrong` 或 note 指出事实/答案问题 | “C 和 D 解释一样”, “这个答案不对” | 高风险，route: REGEN，强模型/人工 |
| `term` 或填写 unclear term | “TPS 是什么”, “FST 是什么” | ENRICH 或 AUTHORING，先补术语/小卡 |
| `hard` / `fuzzy` / `unknown` | 多次模糊/忘记同一主题 | 聚类后决定 ENRICH / AUTHORING |
| `more` 或 note 要更多图/表/代码 | “这里应该有架构图”, “能不能加表” | ENRICH |
| 缺 context | “这题单独看不知道问什么” | REGEN |
| 长难句/模板腔 | “直接命中关键约束太多”, “英文不好背” | REGEN 或 ENRICH cleanup |
| 新主题请求 | “想看 Redis Streams”, “补 Payment iframe” | AUTHORING |

## 3. Ignore / Aggregate Only

以下反馈不直接生成候选卡，只进入 report 统计：

- `easy` 且无 note、无 term、无 wrong flag。
- 单次 `got` 且无任何 flag/note/term。
- “不懂”“再讲讲”但没有 term、没有卡片上下文、没有具体痛点。
- 已有 open candidate 覆盖同一卡同一问题。
- 明显不是学习内容需求：UI 喜好、临时情绪、与卡无关的备忘。
- 已被 M3 明确砍掉的方向：难度课程顺序、自动语音评分、位图/照片生成。

聚合阈值：同一 deck / tag 下出现 ≥3 次同类低信号反馈，可以升级成一个 triage item。

## 4. Route Rules

### REGEN

交给 REGEN，当需要改卡片核心判断或学习上下文：

- 改 `q`, `scenario`, `options`, `answer`, `why`, `why_en`
- 题目不是技术判断，或是 trivia
- 缺项目背景/术语落点
- 答案可能错误或干扰项答案泄漏
- 选项解释重复、跨题串稿、模板腔严重
- 数字/SLO 没有公式、单位全称、下游用途

REGEN 默认需要强模型或人工 review，尤其是会改 `answer` 的候选。

### ENRICH

交给 ENRICH，当核心题意正确，只需要补字段：

- `termDefinitions`
- `optionMeanings` / `optionScenarioImpacts` / `optionDirectness`
- Mermaid `diagram` / `optionDiagrams`
- `table`
- `codeSample`
- 短句化补充，但不改答案

低风险 ENRICH 可以用便宜模型起草，但仍要跑质量门。

### AUTHORING

交给 AUTHORING，当反馈暴露出缺失知识点，而不是单张卡的问题：

- 用户反复问同一个前置概念
- 一个术语需要独立小专题
- 原 deck 没有覆盖某个用户需要的主题
- 一张卡太硬，应该拆成 2-4 张更小的卡

新卡必须带 provenance：`origin: "ai"`, `generatedBy: "feedback"`, `sourceCardId`, `createdAt`, `reviewed: false`。

## 5. Model Tier Policy

| 工作 | 默认模型 |
|---|---|
| dedupe / cluster / summarize feedback | cheap model |
| 低风险 termDefinitions / table / simple diagram draft | cheap model |
| short-sentence cleanup without answer changes | cheap or mid model |
| 改 answer / q / options / why 的 REGEN | strong model / human |
| protocols, databases, security, payments, numbers, infra internals | strong model / human |
| app code, migrations, release/update safety | strong model / human |

模型档位不影响 accept 规则：所有候选都要 human accept。

## 6. Candidate Requirements

每个 candidate 必须包含：

- `sourceCardId`
- 原始 feedback 摘要
- route: `ignore` / `regen` / `enrich` / `authoring`
- risk: `low` / `medium` / `high`
- model tier used
- rationale：为什么这样处理
- diff 或 new card JSON
- validation commands run
- human decision: `pending` / `accepted` / `edited` / `rejected`

## 7. Quality Gates

接受前至少跑：

```bash
node scripts/validate-deck.mjs src/content/<track>/<deck>.json
node scripts/audit-card-quality.mjs src/content/<track>/<deck>.json --limit=0
npm run build:deck
npm run verify
```

高风险 batch 还要抽样 judge：

- answer correctness
- standalone context
- speakability
- no template filler
- diagram/table/code actually helps learning

## 8. Cron Safety

Cron job 默认必须：

- `--dry-run` 产 report/candidates，不直接改源 deck。
- 记录 run ledger：输入 hash、时间、模型、输出、验证结果。
- 同一 feedback hash 不重复生成。
- validation fail 立即停止，不继续写入后续文件。
- 不自动 commit、不自动 push、不自动发布 bundle。

可以自动做的事：整理反馈、生成报告、生成候选、跑校验。  
必须人工做的事：accept 内容、合并高风险修改、发布新版本。
