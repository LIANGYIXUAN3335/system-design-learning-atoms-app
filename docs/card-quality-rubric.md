---
version: 2026-07-04.1
---

# Card quality rubric（逐字段质量标准 · 重写/生成的唯一裁判）

> 📍 **体系导航**：判据总库（唯一权威）。改标准只改这里，再同步各手册转述。全部文档地图：`docs/INDEX.md`。机检规则参考：本文附录 A。
> ⚠️ **改完判据记得把顶部 `version:` 往上拨**（如 `2026-07-04.1`）——backfill cron 以它为触发信号：版本变=全量差量重审，版本不变=跳过已 pass 的卡。

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
| G4 | **单独可答**——不看原文、不看其他卡，scenario+q 提供全部作答信息；缺 context 是 backfill cron 的 P0 修复项 | "文章建议如何扩展优化？"、"last-disconnect 方案的挑战是什么？" → 重写 |
| G5 | **需求澄清必须转成架构影响**——可以考"某个范围决定了哪些组件不用设计 / 哪条主路径要保留"，但不能考原文的 in-scope/out-of-scope 清单记忆 | "哪些功能被明确划为范围外？" → 删；"去掉评论回复后，评论流数据模型为什么可以扁平化？" → 可保留 |
| G6 | **面向 general systems reader 自洽**——假设读者懂常见系统设计原则，但没读过这道具体题、公司案例或产品流程；题干/场景/选项必须交代必要的业务对象、动作、约束、成功标准和每个方案改变了什么 | "BookMyShow 该怎么做 hold？"（没解释 seat hold 是短时锁座、防超卖）→ 重写 |

## 1. 逐字段 metrics

每个字段独立打分。**S = success 判据，F = failure 判据**，`[机检]` 标注 audit 规则名，其余由 LLM judge 抽查。

### 1.1 `scenario`（场景）+ `q`（题干）

- **S1** 场景给出**约束**（规模/延迟/一致性/成本），且约束决定答案——换掉约束答案会变。
- **S2** 题干是一个具体决策问句（"该把聚合放在读路径还是写路径？"），≤40 字；scenario ≤90 字。
- **S3** 不含"文章/上述/这一层/本设计/该系统"式指代 `[missing_context]`。
- **S4** `q` 是用户列表里的事实标题：必须带项目/组件/机制落点，不能只写内部简称（如 "last-disconnect 方案"）。陌生术语首次出现时，scenario 必须用一句话解释它在本系统里是什么。
- **S5** `q + scenario` 必须能作为一张独立截图被理解：读者不知道上一篇卡、原文小节或公司案例时，也能判断是在问哪个系统、哪个机制、哪条约束。
- **S6 双语小字**：每张卡必须有 `q_en`；有 `scenario` 就必须有 `scenario_en` `[missing.q_en]` `[missing.scenario_en]`。英文不是逐词翻译，而是保留同一系统、同一约束、同一技术判断的自然面试英文。
- **S7 generalist setup**：卡片必须对"懂系统设计但没见过这题"的人自洽。scenario 要补足本题专属设定：核心对象（seat/order/comment/file）、动作（hold/book/fanout/sync）、不变量（不能超卖/不能丢消息/读到最新写）、规模或延迟约束，以及为什么这些信息会影响答案。不能假设读者知道 BookMyShow、last-disconnect、live comments replay、Dropbox sync 等具体 problem setup。
- **F1** 场景只是背景板（删掉它答案不变）。
- **F2** 题干单看不知道在问哪个系统的什么决策（用户痛点："放在整个 system 底下才看得懂"）→ 把系统名和关键约束写进 scenario。
- **F3** 纯数字/事实回忆题 `[trivia_or_bad_number_question]`。
- **F4** 裸标题/裸术语：`"last-disconnect 方案的挑战是什么"`、`"成功标准是什么"`、`"这套方案的失败点"`——用户不看前文就不知道是哪套方案、哪个系统、哪个成功/失败维度。
- **F5** 公司/产品名只是标签，没有给技术场景：如只写 "Facebook Live Comments 的核心需求" 而不说明评论流、历史加载、实时增量或规模约束。
- **F6** `q_en` / `scenario_en` 缺失，或英文小字漏掉中文里的关键约束（规模、延迟、一致性、成本、故障场景）。
- **F7** 题目默认读者熟悉具体产品或原题设定：选项看似是几个方案，但读者不知道它们在本题里分别改变了哪条路径、保护哪个不变量、或为什么某个约束重要。

### 1.2 `options` / `options_en`（选项）

- **S1** 每个错误选项 = 一个工程师真会犯的误解，或一个"换个前提就赢"的真实方案（NBME：plausible, homogeneous）。
- **S2** 同类同颗粒度：全是存储方案，或全是策略，不混"技术方案+废话"。
- **S3** 长度均衡：正确项 < 干扰项均值×1.9 `[answer_cue.longest_option]`。
- **S4** **双语**：`options_en` 与 `options` 逐项对齐 `[missing.options_en]`，英文为自然口语句（面试可直接说出口）。
- **S5** 选项必须对 general systems reader 有意义：每个选项要说清它采取的机制或架构动作，而不是只给本题内部简称。读者即使没见过具体系统，也能判断"这个方案会把状态放在哪里 / 何时同步 / 由谁保证一致性 / 失败时怎么恢复"。
- **F1** "以上都对/都不对"、跨领域乱入、明显荒谬项。
- **F2** 正确答案换个说法混进干扰项（LLM 生成典型病，人查/judge 查）。
- **F3** 选项是问题内部黑话或产品动作名，缺少机制含义：如只写 "last-disconnect"、"hold flow"、"replay path"，但不说明它在系统里是断线状态记录、短时库存锁、还是历史事件补放。

### 1.3 选项解析（`optionMeanings` / `optionDirectness` / `optionScenarioImpacts`）

- **S0 覆盖门**：`mcq` / `multi` / `code` 卡必须有完整 option-level 解释：优先六个 rich 字段（中英三字段逐项对齐且非空），或至少 legacy `optionExplanations` + `optionExplanations_en` 完整存在 `[choice.missing_option_notes]`。唯一例外是 S4 的裸数字估算题。
- **S1** 每字段每项 **1 句 ≤70 字** `[too_long.option_note]`；三段形状 = ①它是什么（含术语才写）②它在什么场景更合适 ③放到本场景意味着什么。`optionDirectness` 是历史字段名，新内容把它当作**适用边界/when this option fits**，不要写成"够不够直接"。
- **S2** **一卡一讲**：一个概念在 A 解释过，B/C/D 引用而不重讲 `[redundant.cross_option_repeat]`。
- **S3** 不复读 `why` `[redundant.why_repeated_in_options]`；不含模板腔 `[template_filler]`（"不符合最佳实践"类零信息句 = error）。
- **S3a** 禁止机械套"最直接 / 直接命中题目的关键约束 / 不够直接"。`optionDirectness` 应写**这个方案在哪些约束下会赢**（如"读多写少且可容忍短暂旧数据时，读副本更合适"、"翻旧评论时，`before/cursor` 比 `since` 更合适"）。如果写不出可信适用场景，留空胜于硬凑。
- **S4** **裸数字估算题不写选项解析**：当多数选项只是 `~10ms` / `~100k QPS` 这类裸量级时，数字就是数字，设计含义只写在 `why` `[number.over_explained]`。但如果 `number` 卡问的是数字的来源、取舍、适用场景或排除理由，仍按 S0 补 option-level 解释。
- **S5 清单/分层卡（multi、安全分层、加固手段、优化手段）每项一句"它挡住什么风险 / 把压力从哪里减掉"**——不是名词翻译。范例（容器加固）："read-only filesystem：防止用户代码改依赖、留持久文件"；（写入优化）"batch processing：多条写合成一次事务，减少 commit/WAL flush 次数，但有缓冲丢失风险"。判据：删掉该句后学习者只剩一个名词 = failure。
- **F1** 三段全填但读完无增量（宁可留空——空胜于废话）。

### 1.4 `why` + `tradeoff`（核心解释）

- **S1** `why` ≤2 句/120 字 `[too_long.why]`：第一句=场景里哪条约束决定了答案；第二句（可选）=代价或经验法则。
- **S2** fit/contrast 卡有 `tradeoff` 字段："X vs Y" 一行点名取舍轴 `[tradeoff.not_explicit]`。
- **S3** `whenOtherWins`：1 个条件 1 句 ≤140 字——什么前提变化时被拒绝的方案反超 `[fit.missing_when_other_wins]`。
- **S4 机制/恢复类卡必须走完状态闭环**：讲故障恢复、生命周期、协议交互的卡，`why`（配合解析/`diagram`/`codeSample`）要把链条走完整——正常路径 → 异常发生 → 中间状态 → 恢复动作 → **代价收尾**。范例（Redis Streams）："XREADGROUP 领取 → 未 XACK 留在 PEL → worker 死后 idle 增长 → 别的 worker XCLAIM/XAUTOCLAIM 接管重做 → XACK；代价：可能重复执行，业务要幂等"。只给结论词（"XCLAIM 接管"）跳过中间状态（PEL/idle）= failure；链条里每个术语进 `termDefinitions`。
- **S5 估算/数字卡给三件套**：①公式（"并发 = 注册用户 × 同时在线比例，10 亿 × 20% = 2 亿"）②缩写与单位的全称（"TPS = Transactions Per Second，每秒事务数"）③**这个数字的下游用途**（"它是后续算服务器数量、心跳量的基数"）。数字不是背诵点，是后续推导的输入。若数字是 SLO/SLA/产品目标（如 "<500ms"、"<1 分钟"），必须明说"这是给定目标，不是公式推导结果"，并考它约束哪条设计路径。
- **S5a 量级锚点优先**：凡是解释里出现延迟、QPS/TPS、吞吐、GB/TB、CPU/内存阈值、连接数、对象大小、part/chunk 大小等资源判断，尽量给一个**可解释的粗量级锚点**，格式是"假设/来源 → 算法 → 结论 → 设计含义"。例：LA↔NY 约 4,000km，光纤传播约 200,000km/s，单程物理下限约 20ms、RTT 至少约 40ms；真实网络更高，所以跨地域同步查询不能靠优化 SQL 消掉。CPU 扩容阈值写成"持续 60-70% 开始扩容、80%+ 有排队风险"这种经验值时，必须标注是 rule of thumb，不装成定律。
- **S6 形容词必须落地**："更简单 / 更快 / 更贵 / 更稳"必须指到具体的接口参数、操作步骤或资源数字。范例：offset 分页"简单"不是玄学——接口只传 offset/limit 两个整数、翻页 offset += limit；cursor 则要选稳定排序键、保存上一页末条 id、做 `commentId < cursor` 范围查询。写不出落点的形容词删掉。
- **S7 面试口语硬规则**：中文解释必须像你会在面试里说出口的话。每句只讲一个动作或判断，优先用"先/所以/但/我会/因为"这类自然连接；少用抽象名词串和文档腔。坏例："选择它会把排查带向容量、延迟或性能调优"；好例："我会先怀疑距离太远。容量调优救不了跨洲 RTT。" `[template_filler]`
- **F1** 只说"X 更好"不说牺牲了什么。
- **F2** 绝对化断言（"永远/唯一正确"）——系统设计只有"这些约束下最直接"。
- **F3** 解释像报告摘要而不是口头回答：长从句、多个抽象名词并列、"带向/命中/关键约束/判断路径"这类 AI 模板腔。

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
| 题设依赖 / 产品黑话 | judge（Gate 0 G6 / 1.1-S7 / 1.2-S5） | 把业务对象、动作、不变量、规模/延迟约束写进 scenario；把选项改成机制/架构动作 |
| 裸标题 / 裸术语 | judge | `q` 加系统/机制名，scenario 首句解释术语 |
| 模板废话 | `[template_filler]`（error） | 删句；写不出具体内容就留空 |
| `optionDirectness` 口癖 | judge | 去掉"最直接/直接命中/不够直接"，改写为这个方案更合适的约束：规模/一致性/成本/时机/资源 |
| 复读 why / 跨选项重复 | `[redundant.*]` | 每句必须新增信息；概念一卡一讲 |
| 长度泄漏答案 | `[answer_cue.longest_option]` | 均衡选项长度 |
| 取舍缺失 | `[tradeoff.not_explicit]` | 补 `tradeoff` 或 why 里写代价 |
| 选项无英文 | `[missing.options_en]` | 补 `options_en` |
| 题干/场景无英文小字 | `[missing.q_en]` / `[missing.scenario_en]` | 补自然英文 `q_en` / `scenario_en` |
| 术语不可朗读 | `[speech.jargon_untold]` | 补 `termDefinitions.meaningEn` |
| 裸数字题过度解释 | `[number.over_explained]` | 删选项解析，设计含义进 `why` |
| 机制链条断裂（只给结论词） | judge（1.4-S4） | 补全"正常→异常→恢复→代价"整链 + 链上术语进词表 |
| 数字没有公式/单位/用途 | judge（1.4-S5） | 补估算三件套 |
| 资源判断缺量级锚点 | judge（1.4-S5a） | 给假设/公式/粗量级/设计含义；不确定就标 rule of thumb |
| 形容词悬空（"更简单"没落点） | judge（1.4-S6） | 指到具体接口参数/操作/资源数字 |
| 不像面试口语 | `[template_filler]` + judge（1.4-S7） | 拆短句；改成"我会先…因为…但代价是…" |
| 清单题名词罗列 | judge（1.3-S5） | 每项一句"挡什么风险/减哪里压力" |

## 3. 讲解十二律（写 scenario/why/解析时的风格约束，源自 Hello Interview 逆向）

1. 先痛点后术语（"DB 在 10k QPS 顶不住了"→ 再说 cache）；2. 数字锚定成对给（"内存 1ms vs 磁盘 50ms"），有距离/容量/吞吐/CPU 判断就给粗量级算法；3. 有 naive 方案先摆后破；4. 点名取舍轴 + 每选项一条 "use this when…"；5. 推荐方案同口气说代价；6. 术语首现即释；7. 一个具名例子扛抽象（Taylor Swift 热 key）；8. 收尾给可带走的一句（经验法则/自检问句）；9. 取舍压成 yes/no 自检（"每次读都必须读到最新写吗？"）；10. 第二人称短句；11. 陌生机制先类比（"hash slot 像电话簿"）；12. 结构匹配内容（流程用步骤、并列用词条、代码只放可跑命令）；13. 像面试口语，不像技术报告：一句一个判断，能背、能说、能跟读。

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
| `template_filler` | **error** | 零信息模板句或 AI 文档腔（"代表一种可以拿来比较的判断路径"、"选择它会把排查带向…"等） | 改成面试口语短句；写具体误解/后果，或留空 |
| `answer_cue.longest_option` | warn | 正确项 >1.9× 干扰项均长（NBME 长度均衡） | 均衡选项长度 |
| `tradeoff.not_explicit` | warn | fit/contrast 卡无 `tradeoff` 字段且 why 无双边取舍语 | 补 "X vs Y" 或 why 里写代价 |
| `contrast.missing_comparison_table` | warn | contrast 卡对比 ≥2 具名技术但无 `table` | 补横向对比表（§1.7） |
| `table.non_discriminative` | warn | 表格某列所有行同值 | 换成能区分方案的维度 |
| `table.cell_over_budget` | warn | 表头 >8 字或单元格 >20 字 | 单元格短语化，长句移出表格 |
| `missing.options_en` | warn | 选择卡无 `options_en` | 补英文选项（逐项对齐） |
| `missing.q_en` | warn | 卡片无英文题干小字 | 补自然英文 `q_en`，保留同一技术判断 |
| `missing.scenario_en` | warn | 有 `scenario` 但无英文场景小字 | 补自然英文 `scenario_en`，保留约束与系统背景 |
| `speech.jargon_untold` | warn | 错误选项含术语但 termDefinitions 无带 meaningEn 的条目 | 补可朗读的术语定义 |
| `terms.missing_full_name` | warn | 缩写术语（CRDT/OT/mTLS 形）无 `fullName` | 补全称展开（§1.5-S2b）。实现注记：`ABBREV_RE = /^[a-z]?[A-Z][A-Za-z]{0,4}[A-Z]s?$\|^[A-Z]{2,6}s?$/`；此规则曾两次被并发编辑覆盖，维护脚本者请确认在位（JARGON_RE 同时补 CRDT/OT/SDP/QUIC） |
| `number.over_explained` | warn | 裸数字估算卡写了选项解析 | 删解析，设计含义进 why（§1.3-S4） |
| `missing_context` | warn | 题干用指代词（这一层/文章）且无 scenario | 把系统与约束写进 scenario |
| `trivia_or_bad_number_question` | warn | 选项多为数字的裸数字题 / number 卡无场景 | 数字作前提考设计含义（Gate 0 G3） |
| `bad_distractors` (`choice.generic_explanation`) | warn | 多个选项解释是"不符合要求"式套话 | 写出每个选项代表的误解 |
| `choice.missing_option_notes` | warn | 非裸数字估算选择题没有完整 option-level 解释 | 补 rich 三字段中英版本；若已有高质量 legacy 解释，可先补 `optionExplanations_en` |
| `choice.legacy_only` | warn | 只有 `optionExplanations` 无三字段 | 重要卡迁移到三字段形式 |
| `jargon_not_explained` (`terms.undefined`) | warn | 题干/选项术语密集但无本地解释 | 补 termDefinitions 或场景内释义 |
| `fit.missing_when_other_wins` | **error** | fit 选择卡缺 `whenOtherWins` | 写被拒方案何时反超 |
| `explanation.truncated_or_cross_topic` | **error** | 文本疑似截断或跨题串稿 | 从本卡场景整体重写解释 |

输出：`npm run quality:audit -- --limit=80`（人读队列）；`--json --limit=200`（批处理）。
