# Atoms 文档索引（唯一入口 · 找东西从这里开始）

> 所有标准、流程、规范的地图。文件分散在三个目录是历史原因（agent 就近读取），**导航统一走这里**。

## 我想做什么 → 读哪个文件

| 你要做的事 | 读这个 | 位置 |
|---|---|---|
| **查一张卡算不算好**（成功/失败标准） | card-quality-rubric.md | `docs/` |
| **从文章写新卡**（schema、拆卡法、id 规则） | AUTHORING_SPEC.md | `scripts/` |
| **从面试复盘生成新卡**（检测新 marker 块 → 造卡 → accept） | REVIEW_INGEST_SPEC.md | `docs/` |
| **批量重写存量卡**（五步循环 + Codex 启动 prompt） | REGEN_FLOW.md | `docs/` |
| **只给卡补字段**（选项解析/tradeoff/table，patch 制；REGEN 完成后退役） | ENRICH_SPEC.md | `scripts/` |
| **查某条机检规则什么意思** | card-quality-rubric.md **附录 A** | `docs/` |
| **给 judge 写打分 prompt**（fail/pass 校准样本，整个文件可直接进 prompt） | judge-calibration.md | `docs/` |
| **把用户 feedback 路由到 REGEN/ENRICH/AUTHORING** | feedback-triage-rubric.md | `docs/` |
| **看下一步做什么**（M3 路线图） | atoms-m3-spec.md | 上级目录 |
| **跑 app / 内容工作流命令** | README.md | 仓库根 |

## 当前阅读顺序与文档状态

日常不要把 M1/M2/M2A 文档都当成当前 roadmap 看。默认阅读顺序是：

```
docs/INDEX.md
  ↓
../atoms-m3-spec.md                         当前路线图
  ↓
docs/card-quality-rubric.md                 内容质量唯一判据
  ↓
docs/REGEN_FLOW.md / scripts/AUTHORING_SPEC.md / scripts/ENRICH_SPEC.md
```

如果旧文档和 M3 / rubric 冲突，**以 M3 + rubric 为准**；旧文档只保留产品背景、架构背景和历史决策。

| 状态 | 文件 | 作用 | 是否作为当前任务来源 |
|---|---|---|---|
| **ACTIVE** | `../atoms-m3-spec.md` | 当前 M3 路线图：P0/P1/后续版本 | 是 |
| **ACTIVE** | `docs/card-quality-rubric.md` | 卡片质量唯一判据；rubric-driven backfill cron 的输入 | 是 |
| **ACTIVE** | `docs/REGEN_FLOW.md` | 存量卡重写流程 | 是 |
| **ACTIVE** | `scripts/AUTHORING_SPEC.md` | 新卡 schema / 拆卡 / id 规则 | 是 |
| **ACTIVE** | `scripts/ENRICH_SPEC.md` | 补字段流程；REGEN 完成后可退役 | 临时是 |
| **REFERENCE** | `../atoms-design-doc.md` | 原始产品理念、atom 分类、学习体验 | 否 |
| **REFERENCE** | `../atoms-technical-design.md` | 原始技术架构、study plane / authoring plane、AI subsystem | 否 |
| **REFERENCE** | `../atoms-m2-spec.md` | M2 功能愿景；部分结论已被 M3 修订 | 否 |
| **ARCHIVE** | `../atoms-build-brief.md` | M1 建造简报，已完成 | 否 |
| **ARCHIVE** | `../atoms-m1-review.md` | M1 review / 决策日志 | 否 |
| **ARCHIVE** | `../atoms-m2a-plan.md` | M2A 实施计划，已基本完成或被 M3 接管 | 否 |
| **ARCHIVE** | `../atoms-m2a-review.md` | M2A review / 决策日志 | 否 |

## 权威顺序（改标准只改一处）

```
card-quality-rubric.md  ←—— 判据的唯一权威（Gate 0 生死判据 + 逐字段 S/F + 十二律）
      │ 浓缩转述（改 rubric 后要同步）
      ├── AUTHORING_SPEC.md 的 Hard rules   （写新卡 agent 的一站式手册）
      ├── REGEN_FLOW.md 的 Step 2           （重写 agent 的执行清单）
      └── ENRICH_SPEC.md 的 HARD BUDGETS    （补字段 agent 的硬约束）

rubric 附录 A ←—— audit-card-quality.mjs 的规则文档（机检是 rubric 中标 [机检] 项的执行器）
docs/judge-calibration.md ←—— judge 的 few-shot 校准样本（机器查不了的判据靠它对齐）
docs/feedback-triage-rubric.md ←—— content update cron 的反馈路由/忽略/模型档位标准
```

**规则：新标准先进 rubric，再同步各手册的转述段；只改手册不改 rubric = 漂移，禁止。**

## 内容四管线（共用 rubric，操作范围不同）

| 管线 | 干什么 | 改动范围 | 规范 |
|---|---|---|---|
| AUTHORING | 从文章造全新 deck（HelloInterview / docs），或从面试复盘 action item 造卡 | 新建 `src/content/<track>/*.json` | AUTHORING_SPEC.md（Mode A / Mode B） |
| REGEN | 按 rubric 整卡重写存量（Gate 0 可删卡） | 直接编辑 deck JSON（禁改 id） | REGEN_FLOW.md |
| ENRICH | 只补解析/tradeoff/table 等字段 | 只产 `scripts/enrich-patches/`，apply-enrich.mjs 合并 | ENRICH_SPEC.md |
| REVIEW-INGEST | 每次面试复盘后，检测 3 个复盘文件的新 marker 块 → 交给 AUTHORING（Mode B）造卡；人工 accept 门 | 检测器改 ledger；造卡走 AUTHORING | REVIEW_INGEST_SPEC.md + `scripts/review-ingest-cron.mjs` |

## Content Update System（P0 rubric backfill + P1 feedback cron）

```
P0: latest card-quality-rubric.md
        ↓
    content-quality-backfill-cron
        ↓
    backfill report / repair batches / run ledger
        ↓
    validate + audit + verify

P1: feedback export
        ↓
    feedback-triage-rubric.md 路由
        ↓
    REGEN / ENRICH / AUTHORING candidates
        ↓
    human accept
```

原则：当前 P0 是 **rubric-driven backfill cron**，因为质量标准会不断更新，存量卡需要反复按新标准重扫。用户 feedback 驱动的 cron 是 P1，等 API/feedback 接入后再做。技术版本更新手动控；内容更新可以周期跑，但不能绕过质量门。

## 质检闭环（generate → observe → judge → revise）

```
生成/重写 ──→ 机检 audit-card-quality.mjs（error=0 门）──→ judge 抽查 10 张
                    ↑                                      （rubric §1 + m3 §4.4 样本）
                    └────────── fail 带理由回炉（≤2 轮，仍挂标 needsHuman）←──┘
最后：npm run build:deck && npm run verify（schema + 逻辑 + Mermaid 三道门）
```

## 完整文件清单

**活跃（日常会改）**
- `docs/card-quality-rubric.md` — 判据总库（唯一权威）+ 附录 A 机检规则参考
- `docs/judge-calibration.md` — judge few-shot 校准样本（可整体进 prompt）
- `docs/feedback-triage-rubric.md` — feedback → 路由 / 忽略 / 模型档位 / candidate 标准
- `docs/REGEN_FLOW.md` — 重写流程 + Codex prompt
- `docs/INDEX.md` — 本文件
- `scripts/AUTHORING_SPEC.md` — 新卡手册（Hard rules = rubric 浓缩转述）
- `scripts/ENRICH_SPEC.md` — 补字段手册（REGEN 完成后退役）
- `../atoms-m3-spec.md` — M3 路线图
- `README.md` — 运行与内容工作流
- `scripts/CARD_QA_SPEC.md` — 指针 stub（内容已并入 rubric 附录 A）

**参考（一般只读；保留产品/架构背景）**
- `../atoms-design-doc.md` — 产品理念（原子分类法的源头）
- `../atoms-technical-design.md` — 两平面架构
- `../atoms-m2-spec.md` — M2 spec（M3 已修订其中部分结论）

**归档（已完成/被 M3 接管；只作历史依据）**
- `../atoms-build-brief.md` — M1 建造简报
- `../atoms-m1-review.md` — M1 审查与决策日志（改核心行为前可查这里，别推翻已定决策）
- `../atoms-m2a-plan.md` — M2A 实施计划
- `../atoms-m2a-review.md` — M2A 审查与决策日志
- `docs/qa-sampled-correctness-*.md` — 抽样 QA 报告（快照）

## 常用命令

```bash
npm run quality:audit -- --limit=120   # 机检（rubric [机检] 项）
npm run build:deck                     # 合并 deck → bundle（注入 track tag）
npm run verify                         # typecheck + selftest + Mermaid 校验
node scripts/validate-deck.mjs src/content/<track>/<deck>.json   # 单 deck schema 检查
```
