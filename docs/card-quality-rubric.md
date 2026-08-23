---
version: 2026-07-08.2
---

# Card quality rubric（逐字段质量标准 · 重写/生成的唯一裁判）

> 📍 **体系导航**：判据总库（唯一权威）。改标准只改这里，再同步各手册转述。全部文档地图：`docs/INDEX.md`。机检规则参考：本文附录 A。

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
| G5 | **需求澄清必须转成架构影响**——可以考"某个范围决定了哪些组件不用设计 / 哪条主路径要保留"，但不能考原文的 in-scope/out-of-scope 清单记忆 | "哪些功能被明确划为范围外？" → 删；"去掉评论回复后，评论流数据模型为什么可以扁平化？" → 可保留 |

## 1. 逐字段 metrics

每个字段独立打分。**S = success 判据，F = failure 判据**，`[机检]` 标注 audit 规则名，其余由 LLM judge 抽查。

### 1.1 `scenario`（场景）+ `q`（题干）

- **S1** 场景给出**约束**（规模/延迟/一致性/成本），且约束决定答案——换掉约束答案会变。
- **S2** 题干是一个具体决策问句（"该把聚合放在读路径还是写路径？"），≤40 字；scenario ≤90 字。
- **S3** 不含"文章/上述/这一层/本设计/该系统"式指代 `[missing_context]`。
- **S4** `q` 是用户列表里的事实标题：必须带项目/组件/机制落点，不能只写内部简称（如 "last-disconnect 方案"）。陌生术语首次出现时，scenario 必须用一句话解释它在本系统里是什么。
- **F1** 场景只是背景板（删掉它答案不变）。
- **F2** 题干单看不知道在问哪个系统的什么决策（用户痛点："放在整个 system 底下才看得懂"）→ 把系统名和关键约束写进 scenario。
- **F3** 纯数字/事实回忆题 `[trivia_or_bad_number_question]`。
- **F4** 裸标题/裸术语：`"last-disconnect 方案的挑战是什么"`、`"成功标准是什么"`、`"这套方案的失败点"`——用户不看前文就不知道是哪套方案、哪个系统、哪个成功/失败维度。

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
- **S3a** `optionDirectness` 不能机械套"最直接 / 直接命中题目的关键约束 / 不够直接"。成功项直接写**它抓住的具体差异**（如"读副本不能分摊写提交"、"`before` 才能翻旧评论"）；错误项写**错在方向、粒度、状态、时机或约束哪一层**。如果删掉"最直接"三个字句子就没信息 = failure。
- **S4** **number 题不写选项解析**：数字就是数字，设计含义只写在 `why` `[number.over_explained]`。
- **S5 清单/分层卡（multi、安全分层、加固手段、优化手段）每项一句"它挡住什么风险 / 把压力从哪里减掉"**——不是名词翻译。范例（容器加固）："read-only filesystem：防止用户代码改依赖、留持久文件"；（写入优化）"batch processing：多条写合成一次事务，减少 commit/WAL flush 次数，但有缓冲丢失风险"。判据：删掉该句后学习者只剩一个名词 = failure。
- **F1** 三段全填但读完无增量（宁可留空——空胜于废话）。

### 1.4 `why` + `tradeoff`（核心解释）

- **S1** `why` ≤2 句/120 字 `[too_long.why]`：第一句=场景里哪条约束决定了答案；第二句（可选）=代价或经验法则。
- **S2** fit/contrast 卡有 `tradeoff` 字段："X vs Y" 一行点名取舍轴 `[tradeoff.not_explicit]`。
- **S3** `whenOtherWins`：1 个条件 1 句 ≤140 字——什么前提变化时被拒绝的方案反超 `[fit.missing_when_other_wins]`。
- **S4 机制/恢复类卡必须走完状态闭环**：讲故障恢复、生命周期、协议交互的卡，`why`（配合解析/`diagram`/`codeSample`）要把链条走完整——正常路径 → 异常发生 → 中间状态 → 恢复动作 → **代价收尾**。范例（Redis Streams）："XREADGROUP 领取 → 未 XACK 留在 PEL → worker 死后 idle 增长 → 别的 worker XCLAIM/XAUTOCLAIM 接管重做 → XACK；代价：可能重复执行，业务要幂等"。只给结论词（"XCLAIM 接管"）跳过中间状态（PEL/idle）= failure；链条里每个术语进 `termDefinitions`。
- **S5 估算/数字卡给三件套**：①公式（"并发 = 注册用户 × 同时在线比例，10 亿 × 20% = 2 亿"）②缩写与单位的全称（"TPS = Transactions Per Second，每秒事务数"）③**这个数字的下游用途**（"它是后续算服务器数量、心跳量的基数"）。数字不是背诵点，是后续推导的输入。若数字是 SLO/SLA/产品目标（如 "<500ms"、"<1 分钟"），必须明说"这是给定目标，不是公式推导结果"，并考它约束哪条设计路径。
- **S6 形容词必须落地**："更简单 / 更快 / 更贵 / 更稳"必须指到具体的接口参数、操作步骤或资源数字。范例：offset 分页"简单"不是玄学——接口只传 offset/limit 两个整数、翻页 offset += limit；cursor 则要选稳定排序键、保存上一页末条 id、做 `commentId < cursor` 范围查询。写不出落点的形容词删掉。
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
| 裸标题 / 裸术语 | judge | `q` 加系统/机制名，scenario 首句解释术语 |
| 模板废话 | `[template_filler]`（error） | 删句；写不出具体内容就留空 |
| `optionDirectness` 口癖 | judge | 去掉"最直接/直接命中"开头，改写为具体差异：方向/粒度/状态/时机/资源 |
| 复读 why / 跨选项重复 | `[redundant.*]` | 每句必须新增信息；概念一卡一讲 |
| 长度泄漏答案 | `[answer_cue.longest_option]` | 均衡选项长度 |
| 取舍缺失 | `[tradeoff.not_explicit]` | 补 `tradeoff` 或 why 里写代价 |
| 选项无英文 | `[missing.options_en]` | 补 `options_en` |
| 术语不可朗读 | `[speech.jargon_untold]` | 补 `termDefinitions.meaningEn` |
| number 题过度解释 | `[number.over_explained]` | 删选项解析，设计含义进 `why` |
| 机制链条断裂（只给结论词） | judge（1.4-S4） | 补全"正常→异常→恢复→代价"整链 + 链上术语进词表 |
| 数字没有公式/单位/用途 | judge（1.4-S5） | 补估算三件套 |
| 形容词悬空（"更简单"没落点） | judge（1.4-S6） | 指到具体接口参数/操作/资源数字 |
| 清单题名词罗列 | judge（1.3-S5） | 每项一句"挡什么风险/减哪里压力" |

## Gate 3 — 技术严谨性（2026-10-15 加，生成 / 重写 / 新 track 一律必过）

> 来源：她 10/15 给的审计规范 `docs/RIGOR_AUDIT_SPEC.md`（7 项 0–2 分 rubric + Hard Fail + 七个已知问题模式）。
> 试跑 126 张：PASS 59% / MINOR 33% / MAJOR 8%；阶段 06 前 700 张 PASS 只有约 55%。**这些毛病是生成器犯的，不是个别卡的事**，
> 所以写在这里当生成时的硬门，不只当事后审计。细则和判分以 RIGOR_AUDIT_SPEC 为准，这里是浓缩转述。

核心原则：**题库给的答案只是待验证的假设。** 读者只看 scenario + 选项、不看解释，必须能推出唯一最佳答案；解释区不得补题面缺的前提。

| # | 硬规矩（违反 = error，不许出卡） | 最常见的犯法（审计实抓） |
|---|---|---|
| G3-1 | **前提写进 scenario**：决定答案的每个条件（第一次请求成功没有、任务还在跑没有、数字、范围内外）都在题面里 | PUT 重试 409 却没说第一次已落库；要求题「个性化不在范围」只在解释里说 |
| G3-2 | **答案唯一**：其他选项在合理解释下不成立；多选题正确集合唯一；填空题填法唯一 | 「单实例」没说是不是单节点，A 和 C 都对 |
| G3-3 | **禁无依据的绝对词**：`必须 / 一定 / 永远 / always / never / must / 必备` 要么有标准（RFC、官方文档）或题面约束撑着，要么改成「通常 / 在这个场景下」 | 「所有列表 API 必备分页」「缺一个条件就该降级」 |
| G3-4 | **经验数字带 workload 假设**：QPS / TPS / 延迟 / 容量必须写明依赖（payload、索引、durability 配置、并发、缓存命中率、机器规格），不写成固定常数 | 「PostgreSQL 单实例 5k–20k 连接」「Redis 单节点 10 万 QPS」「SSD 快 100 倍」 |
| G3-5 | **分清四层**：protocol guarantee / common implementation / design recommendation / problem-specific decision，不把后三者写成第一者 | 「Kafka 消息没有硬限制」（有，message.max.bytes）；「1MB 是推荐值」（是 ZooKeeper 默认硬限） |
| G3-6 | **术语层次准确**：REST 是风格、RESTful 是遵循它；safe ≠ idempotent；幂等 = 重复不产生额外状态变化，**不要求响应相同**；业务超时 / 执行超时 / 网络超时 / 等待超时分开说；authoritative state / user-visible state / attempt history / audit log 分开说 | 「REST 是宽松集合、RESTful 是严格子集」；「PUT 幂等所以重试响应一定一样」 |
| G3-7 | **中英同约束**：`scenario_en / q_en / options_en / why_en` 不得多一个前提、少一个条件、换一个数字 | why_en 多了「10x throughput」；中文「实现了 11 个 9」英文「宣称」 |
| G3-8 | **数字自洽**：scenario、选项、解释、table、numberAnchors 里的数字互相对得上，算术要对 | 5GB→1GB 写成「砍了四分之三」；8640/288 = 30 倍写成「两个数量级」；采样误差数列不符合自己给的 1/√m |
| G3-9 | **干扰项真错**：错在工程上站不住，不是「不如标准答案常见」；不靠绝对化措辞制造错 | D 选项只因写了「永远」才错 |
| G3-10 | **不靠外物**：答案不能只因「参考架构这样画」或「某篇文章这么说」成立；diagram 里的条件要同时出现在 scenario | 「第一次 200、version 变 4」只画在图里 |

写新 track / 新 deck 时的用法：生成 prompt 里把本表原样带上；写完先过 `audit-card-quality` 机检，再按 `RIGOR_AUDIT_SPEC.md`「独立审核流程」抽 20% 做遮答案独立作答，MAJOR 率 > 10% 整批打回。
存量审计与修订的流水线见 `scripts/rigor-audit/`（make-batches → 审计员 → plan-patch → 改卡员）。

## Gate 4 — 可交付设计产物（2026-10-16 加，problem-breakdowns 必过）

她的验收问题：**合上选项以后，能不能从白纸写出这个系统的 schema、API、组件和核心流程？** 不能 = deck 只训练了识别，没完成面试训练。

**4.1 每张卡标 `deliverable`**（十一类：entities / schema / api / components / flow / state / concurrency / recovery / capacity / scaling / tech）。标不出来的卡（达标线、方法论、需求句式、"更普遍的教训"）就是 Gate 0 该删的卡；每 deck 最多留 1 张合并版「这题 E4 / E5 看什么」，meta 卡总量 ≤ 5%。

**4.2 选项是候选设计，不是原则**：schema 卡给四种真实的表 / 主键 / 索引 / 状态字段布局；API 卡给四个真实 contract；架构卡用 `optionDiagrams`；状态机 / 流程卡给四种顺序；选型卡必须答得出「放哪个组件后、存什么、按什么 key 查、坏了怎么办、什么条件下换」。禁止「schema 重要吗」「API 该 RESTful 吗」「哪个更 scalable」。

**4.3 覆盖合同**（教材给了信息的前提下，每 deck）：① 一组核心 entities ② 一个具体 schema 决策 ③ 一个 API contract 决策 ④ 一张高层组件图 ⑤ 一条端到端主流程 ⑥ 一条核心状态转换 ⑦ 一个并发或幂等问题 ⑧ 一个故障恢复闭环 ⑨ 一个 scaling bottleneck ⑩ 教材里每个主要技术选型及 trade-off。缺一项标 `MISSING`，不得用通用原则卡顶替。

**4.4 识别 + 产出成对**：①–⑨ 每类至少 1 张 recognition（mcq / multi / cloze / code / chain）+ 1 张 `produce`（先写后揭晓）。produce 的 `checklist` 每条当场能判真假（「三个 entity 都写了主键」「Ride.status ≥ 4 个状态且含 REQUESTED→ACCEPTED」），不写感觉词；参考答案在 `codeSample` / `diagram`。

**4.5 API 五件套**（Apple 9/24 原话「每个端点一次给全五件套」）：`api` 的 produce 卡清单必须覆盖 **方法、header（鉴权怎么带）、body、响应形状、状态码（含非 happy path：401 / 403 / 404 / 409 / 429）**；有分页的要写 cursor 由哪些字段组成。机检 `API_INCOMPLETE`。

**4.6 capacity 先给数再指瓶颈**：`capacity` 的 produce 卡 = 写 3 行估算（QPS / 存储 / 带宽，公式 + 数量级）→ 指出第一个爆的组件 → 短期一招 + 长期一招。清单里必须有数字和「瓶颈 / 第一个爆」。机检 `CAPACITY_INCOMPLETE`。

机检：`node scripts/audit-deliverables.mjs --strict <deck>`（MISSING / NO_PRODUCTION / UNTAGGED 退出码 1；META_HEAVY 只警告）。设计稿：`docs/DESIGN_deliverable-cards_2026-10-16.md`。

## 3. 讲解十二律（写 scenario/why/解析时的风格约束，源自 Hello Interview 逆向）

1. 先痛点后术语（"DB 在 10k QPS 顶不住了"→ 再说 cache）；2. 数字锚定成对给（"内存 1ms vs 磁盘 50ms"）；3. 有 naive 方案先摆后破；4. 点名取舍轴 + 每选项一条 "use this when…"；5. 推荐方案同口气说代价；6. 术语首现即释；7. 一个具名例子扛抽象（Taylor Swift 热 key）；8. 收尾给可带走的一句（经验法则/自检问句）；9. 取舍压成 yes/no 自检（"每次读都必须读到最新写吗？"）；10. 第二人称短句；11. 陌生机制先类比（"hash slot 像电话簿"）；12. 结构匹配内容（流程用步骤、并列用词条、代码只放可跑命令）。

## 4. 验证命令

```bash
npm run quality:audit -- --limit=120     # 全部 [机检] 项
npm run build:deck && npm run verify     # schema + 逻辑 + Mermaid
```

机检 error=0 才可入库；warn 进 review 队列。机器查不了的（1.2-F2 答案泄漏、1.1-S1 约束决定答案、1.5-S1 口语自然度、Gate 0 G1/G2）由 judge 按本文件逐项 pass/fail（校准样本：`docs/judge-calibration.md`；流程：`docs/REGEN_FLOW.md`）。

## 附录 A · 机检规则参考（audit-card-quality.mjs 的全部规则）

> 原 `scripts/CARD_QA_SPEC.md` 已并入此处。列出规则名 → 严重度 → 检测 → 修法；正文判据里的 `[机检]` 标注即指向本表。

| 规则 | 级别 | 检测 | 修法 |
|---|---|---|---|
| `too_long.why` / `.when_other_wins` / `.option_note` / `.reveal_total` | warn→error | 字符预算超标（why ≤120/170；解析每项 ≤70/110；whenOtherWins ≤140；reveal 总量 ≤420） | 砍到只讲一个判断；装不下拆卡 |
| `redundant.why_repeated_in_options` | warn | 选项解析与 `why` 有 ≥14 字逐字重合 | 解析必须新增信息，不复读 why |
| `redundant.cross_option_repeat` | warn | 两个选项的解析共享 ≥16 字重合段 | 概念一卡一讲，其余选项引用 |
| `template_filler` | **error** | 零信息模板句（"代表一种可以拿来比较的判断路径"等） | 写具体误解/后果，或留空 |
| `answer_cue.longest_option` | warn | 正确项 >1.9× 干扰项均长（NBME 长度均衡） | 均衡选项长度 |
| `tradeoff.not_explicit` | warn | fit/contrast 卡无 `tradeoff` 字段且 why 无双边取舍语 | 补 "X vs Y" 或 why 里写代价 |
| `contrast.missing_comparison_table` | warn | contrast 卡对比 ≥2 具名技术但无 `table` | 补横向对比表（§1.7） |
| `table.non_discriminative` | warn | 表格某列所有行同值 | 换成能区分方案的维度 |
| `table.cell_over_budget` | warn | 表头 >8 字或单元格 >20 字 | 单元格短语化，长句移出表格 |
| `missing.options_en` | warn | 选择卡无 `options_en` | 补英文选项（逐项对齐） |
| `speech.jargon_untold` | warn | 错误选项含术语但 termDefinitions 无带 meaningEn 的条目 | 补可朗读的术语定义 |
| `terms.missing_full_name` | warn | 缩写术语（CRDT/OT/mTLS 形）无 `fullName` | 补全称展开（§1.5-S2b）。实现注记：`ABBREV_RE = /^[a-z]?[A-Z][A-Za-z]{0,4}[A-Z]s?$\|^[A-Z]{2,6}s?$/`；此规则曾两次被并发编辑覆盖，维护脚本者请确认在位（JARGON_RE 同时补 CRDT/OT/SDP/QUIC） |
| `number.over_explained` | warn | number 卡写了选项解析 | 删解析，设计含义进 why（§1.3-S4） |
| `missing_context` | warn | 题干用指代词（这一层/文章）且无 scenario | 把系统与约束写进 scenario |
| `trivia_or_bad_number_question` | warn | 选项多为数字的裸数字题 / number 卡无场景 | 数字作前提考设计含义（Gate 0 G3） |
| `bad_distractors` (`choice.generic_explanation`) | warn | 多个选项解释是"不符合要求"式套话 | 写出每个选项代表的误解 |
| `choice.legacy_only` | warn | 只有 `optionExplanations` 无三字段 | 重要卡迁移到三字段形式 |
| `jargon_not_explained` (`terms.undefined`) | warn | 题干/选项术语密集但无本地解释 | 补 termDefinitions 或场景内释义 |
| `fit.missing_when_other_wins` | **error** | fit 选择卡缺 `whenOtherWins` | 写被拒方案何时反超 |
| `explanation.truncated_or_cross_topic` | **error** | 文本疑似截断或跨题串稿 | 从本卡场景整体重写解释 |

输出：`npm run quality:audit -- --limit=80`（人读队列）；`--json --limit=200`（批处理）。

## Gate 2 — 源文覆盖率（deck 级门槛，2026-07-20 加）

前面所有判据都是**逐卡**的：它们能保证"存在的卡是好卡"，但管不了"该有的卡不存在"。
生成时按配额停机的后果：low-level-design 有 7 个 deck 恰好停在 45 张、llm-sd 有 21 个恰好停在
25 张，与源文长短无关。于是 10,085 词的文章和 6,752 词的文章拿到同样 45 张卡，长文章的后半段
（深挖、故障模式、容量估算——面试区分度最高的部分）被整段丢弃。

**判据**：一个 deck 的卡片数 ≥ `ceil(源文词数 / 120)`。

- 机检：`npm run coverage:audit`（`scripts/audit-coverage.mjs`，不达标 exit 1）。
- 120 是**地板不是目标**：全库中位数约 85 词/卡，120 相当于允许比中位数稀疏 40%。
- 补卡时**不要从文章开头再抠**——缺口几乎总在后半段。优先补：故障模式与恢复路径、容量/QPS
  估算、面试官常见 follow-up、方案对比的第二三个候选。
- 新增的卡同样要过 Gate 0 和 §1 全部字段判据；宁可少补几张真卡，也不要凑数。

## 附录 B — 长度线索的两级判据（2026-07-20 加）

`answer_cue.longest_option`（error 级）只抓"正确项比干扰项均值长 1.9 倍"这类刺眼案例。实测发现
它远不足以守住 1.2-S3：**全库 7,515 道单选题里，5,639 道（75%）的正确答案恰好是最长选项**，而
四选一的随机基线是 25%。也就是说一个完全不懂的人「永远选最长」能考 75 分。

危害不只是"练习被绕过"，更是**自我评估被污染**：正确率虚高 → 判断"这块掌握了" → 把复习时间
分配到别处。一个骗人的评估系统比没有评估系统更糟。

因此加第二级 `answer_cue.longest_option_mild`（warning 级）：正确项只要**是最长的且超出第二长
2 字以上**就报。修法不是把正确答案砍短到失真，而是**让干扰项变得同样具体**——干扰项写得短，
通常说明它是敷衍的假选项（"只决定视频清晰度"），本身就违反 1.2-S1「干扰项必须是工程师真会犯的
误解」。**两个问题往往是同一个问题。**

修完存量后可考虑把 mild 升为 error。
