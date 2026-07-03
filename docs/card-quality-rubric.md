# Card quality rubric（逐字段质量标准 · 重写/生成的唯一裁判）

> 用法：批量重写 agent（Codex/GPT/任意模型）把本文件当 system 约束；`audit-card-quality.mjs` 机检其中可查项；LLM judge 抽查其余。每个字段都有 **success（达标）/ failure（不达标）** 判据——观察结果，对照判据，没达标就重来一轮（回炉流程见 `docs/REGEN_FLOW.md`）。
>
> 依据：SuperMemo 最小信息原则、NBME 命题指南、MCQ 生成研究（LLM 典型失败：幻觉、肤浅干扰项、答案泄漏）、对 Hello Interview 讲解方式的逆向分析（§8 十二律）。

## Gate 0 — 这张卡该不该存在（先判生死，再谈质量）

**全部满足才保留；任一不满足 → 删除或重写，不进入字段打分：**

| # | 判据 | 不满足的例子 |
|---|---|---|
| G1 | **考的是一个技术判断**——数据结构/协议/存储/扩展/一致性/容错的选择或其后果 | "亚马逊每天新增多少商品"（商业事实，非技术）→ 删 |
| G2 | **能追溯到源章节的一个 topic**——HelloInterview 每章讲一个主题下的取舍；卡片继承"章节 topic + 该章讲的那个 tradeoff"，标进 `tags` | 从文章闲聊段落抠出的边角料 → 删 |
| G3 | **量级假设题必须转成设计含义**——"assume 每天 3000 新商品"可以作为**前提**出现，考"这意味着增量发现管线要怎么设计"；直接考数字本身 → 重写或删 | "上限是多少 MB？" → 重写为"4GB 上限 → 上传路径必须怎么设计" |
| G4 | **单独可答**——不看原文、不看其他卡，scenario+q 提供全部作答信息 | "文章建议如何扩展优化？" → 重写 |

## 1. 逐字段 metrics

每个字段独立打分。**S = success 判据，F = failure 判据**，`[机检]` 标注 audit 规则名，其余由 LLM judge 抽查。

### 1.1 `scenario`（场景）+ `q`（题干）

- **S1** 场景给出**约束**（规模/延迟/一致性/成本），且约束决定答案——换掉约束答案会变。
- **S2** 题干是一个具体决策问句（"该把聚合放在读路径还是写路径？"），≤40 字；scenario ≤90 字。
- **S3** 不含"文章/上述/这一层/本设计/该系统"式指代 `[missing_context]`。
- **F1** 场景只是背景板（删掉它答案不变）。
- **F2** 题干单看不知道在问哪个系统的什么决策（用户痛点："放在整个 system 底下才看得懂"）→ 把系统名和关键约束写进 scenario。
- **F3** 纯数字/事实回忆题 `[trivia_or_bad_number_question]`。

### 1.2 `options` / `options_en`（选项）

- **S1** 每个错误选项 = 一个工程师真会犯的误解，或一个"换个前提就赢"的真实方案（NBME：plausible, homogeneous）。
- **S2** 同类同颗粒度：全是存储方案，或全是策略，不混"技术方案+废话"。
- **S3** 长度均衡：正确项 < 干扰项均值×1.9 `[answer_cue.longest_option]`。
- **S4** **双语**：`options_en` 与 `options` 逐项对齐 `[missing.options_en]`，英文为自然口语句（面试可直接说出口）。
- **F1** "以上都对/都不对"、跨领域乱入、明显荒谬项。
- **F2** 正确答案换个说法混进干扰项（LLM 生成典型病，人查/judge 查）。

### 1.3 选项解析（`optionMeanings` / `optionScenarioImpacts` / `optionDirectness`）

- **S1** 每字段每项 **1 句 ≤70 字** `[too_long.option_note]`；错误选项形状 = ①是什么（含术语才写）②什么时候它反而更好 ③本题为什么不选（指回场景的决定性约束）；正确选项一句。
- **S2** **一卡一讲**：一个概念在 A 解释过，B/C/D 引用而不重讲 `[redundant.cross_option_repeat]`。
- **S3** 不复读 `why` `[redundant.why_repeated_in_options]`；不含模板腔 `[template_filler]`（"不符合最佳实践"类零信息句 = error）。
- **S4** **number 题不写选项解析**：数字就是数字，设计含义只写在 `why` `[number.over_explained]`。
- **F1** 三段全填但读完无增量（宁可留空——空胜于废话）。

### 1.4 `why` + `tradeoff`（核心解释）

- **S1** `why` ≤2 句/120 字 `[too_long.why]`：第一句=场景里哪条约束决定了答案；第二句（可选）=代价或经验法则。
- **S2** fit/contrast 卡有 `tradeoff` 字段："X vs Y" 一行点名取舍轴 `[tradeoff.not_explicit]`。
- **S3** `whenOtherWins`：1 个条件 1 句 ≤140 字——什么前提变化时被拒绝的方案反超 `[fit.missing_when_other_wins]`。
- **F1** 只说"X 更好"不说牺牲了什么。
- **F2** 绝对化断言（"永远/唯一正确"）——系统设计只有"这些约束下最直接"。

### 1.5 `why_en`（英文朗读）+ `termDefinitions`（术语卡）

- **S1** `why_en` 是**一句自然的面试口语**（不是翻译腔），能直接对面试官说；覆盖判断+理由。
- **S2** 题干/选项中出现的技术术语（缩写、专有名词）在 `termDefinitions` 有条目：`{term, meaning(中文一句), meaningEn(英文一句，供朗读)}`——**错误选项里的术语也要覆盖** `[speech.jargon_untold]`（用户要求：错误选项的术语都能朗读跟读）。
- **S2a 术语判定标准（按语义判，不依赖固定词表）**：凡是"一个初级工程师被追问'它到底是什么'时可能答不上来"的缩写/协议/机制名，都算术语——JWT、API key、OAuth、mTLS、CDC、quorum、WAL、幂等……宁多勿漏；audit 的词表（`speech.jargon_untold`）只是兜底安全网，判定责任在生成方。
- **S2b 缩写必须给全称**：termDefinitions 条目遇缩写时必填 `fullName`（"CRDT" → "Conflict-free Replicated Data Type"，"OT" → "Operational Transformation"）`[terms.missing_full_name]`；`meaning` 首句建议以"全称（缩写）：定义"展开。学习者第一个问题永远是"它到底是什么的缩写"。
- **S3** `meaningEn` 独立成句可朗读（"A quorum is the minimum number of replicas that must acknowledge a write"），不是短语碎片。
- **F1** `why_en` 直译中文、超过一口气能读完的长度（>180 字符）。
- **F2** 术语只有中文解释没有 `meaningEn`（朗读功能覆盖不到）。

### 1.6 整卡预算

- **S1** reveal 总阅读量（why + whenOtherWins + 全部选项解析）≤420 字，30 秒读完 `[too_long.reveal_total]`。装不下 = 拆卡（对比表不计入此预算——它是扫读结构，不是线性阅读）。

### 1.7 `table`（横向对比表 — decision matrix）

对比类知识的最佳承载：行 = 候选方案，列 = 区分维度，一眼看清全景（决策矩阵的标准形状）。渲染在选项拆解**之后**、作为独立"⚖️ 横向对比"区块。

- **S1 何时必须有**：contrast 选择卡对比 ≥2 个具体技术/方案时（如 PostgreSQL vs Cassandra、SSE vs WebSocket）`[contrast.missing_comparison_table]`；fit 卡的选项若是 ≥3 个具名技术，强烈建议也配。
- **S2 形状**：第一列 = 候选方案名；后续 2-4 列 = **区分维度**（读性能/写扩展/一致性/运维成本/何时选它…）；表头 ≤8 字，单元格 ≤20 字（短语，不是句子）`[table.cell_over_budget]`。
- **S3 维度必须有区分度**：任何一列如果所有行的值都一样，它没有帮助选择——删掉换一个能把方案分开的维度 `[table.non_discriminative]`。
- **S4 与 `why` 的分工**：表格是**中立的地图**（每个方案在每个维度的客观事实，不标"本题答案"）；`why`/`tradeoff` 才是**本题的路线**（哪条约束让我们在这张地图上选了这一行）。表格里出现"✓ 最佳/推荐"= failure（变成第二个答案泄漏源）。
- **S5 同 deck 一致性**：同一组候选方案（同一批数据库/协议）在一个 deck 内的对比表应同构——相同的行集合与维度列，避免两张卡各说各话。
- **F1** 把选项解析的句子搬进单元格（表格是短语密度结构，塞长句两头不讨好）。
- **F2** 为凑表而造表：≤1 个真实维度差异的对比不需要表格，一句 `tradeoff` 就够。

### 1.8 `codeSample`（真实代码 — 机制类卡片的"实现参考"）

学习者对协议/机制类术语（JWT、API key、SETNX、CQL、ES query…）想看**真实格式的代码**才算真懂。已有字段：`codeSample` + `lang`，渲染为"实现参考"代码块。

- **S1 何时必须有**：卡片的判断落在一个**具体机制的用法/格式**上时——认证方式（JWT 的 `header.payload.signature` 三段、API key 的 `Authorization: Bearer/X-API-Key` 请求头）、Redis 命令、建表语句、查询 DSL、HTTP 报文。概念层对比（"一致性 vs 可用性"）不需要。
- **S2 形状**：≤10 行、**真实可跑或真实线上格式**（HI 十二律 12：代码只放真实命令，不放伪代码腔）；带 2-3 行注释点出关键参数为什么这么写（`EX 86400` = 24h 过期）。
- **S3** 与 `table` 配合：对比类卡（JWT vs API key）表格给全景，codeSample 给**正确答案那个方案**的真实样子——不用把每个候选都写一遍代码。
- **F1** 伪代码化的空架子（`doAuth(); // 认证`）——不如不写。
- **F2** 超过 10 行的完整教程式代码——这是卡片不是文档。

## 2. 失败模式速查（F → 检测 → 修）

| 失败 | 检测 | 修法 |
|---|---|---|
| 非技术 trivia | Gate 0 G1 / `[trivia_or_bad_number_question]` | 删，或转 G3 形式 |
| 文章依赖 | `[missing_context]` + judge | 约束搬进 scenario 重写 |
| 模板废话 | `[template_filler]`（error） | 删句；写不出具体内容就留空 |
| 复读 why / 跨选项重复 | `[redundant.*]` | 每句必须新增信息；概念一卡一讲 |
| 长度泄漏答案 | `[answer_cue.longest_option]` | 均衡选项长度 |
| 取舍缺失 | `[tradeoff.not_explicit]` | 补 `tradeoff` 或 why 里写代价 |
| 选项无英文 | `[missing.options_en]` | 补 `options_en` |
| 术语不可朗读 | `[speech.jargon_untold]` | 补 `termDefinitions.meaningEn` |
| number 题过度解释 | `[number.over_explained]` | 删选项解析，设计含义进 `why` |

## 3. 讲解十二律（写 scenario/why/解析时的风格约束，源自 Hello Interview 逆向）

1. 先痛点后术语（"DB 在 10k QPS 顶不住了"→ 再说 cache）；2. 数字锚定成对给（"内存 1ms vs 磁盘 50ms"）；3. 有 naive 方案先摆后破；4. 点名取舍轴 + 每选项一条 "use this when…"；5. 推荐方案同口气说代价；6. 术语首现即释；7. 一个具名例子扛抽象（Taylor Swift 热 key）；8. 收尾给可带走的一句（经验法则/自检问句）；9. 取舍压成 yes/no 自检（"每次读都必须读到最新写吗？"）；10. 第二人称短句；11. 陌生机制先类比（"hash slot 像电话簿"）；12. 结构匹配内容（流程用步骤、并列用词条、代码只放可跑命令）。

## 4. 验证命令

```bash
npm run quality:audit -- --limit=120     # 全部 [机检] 项
npm run build:deck && npm run verify     # schema + 逻辑 + Mermaid
```

机检 error=0 才可入库；warn 进 review 队列。机器查不了的（1.2-F2 答案泄漏、1.1-S1 约束决定答案、1.5-S1 口语自然度、Gate 0 G1/G2）由 judge 按本文件逐项 pass/fail（流程见 `docs/REGEN_FLOW.md`）。
