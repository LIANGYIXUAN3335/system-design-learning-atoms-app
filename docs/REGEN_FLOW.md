# Card regeneration flow（批量重写的 agentic 流程 · 给执行 agent 的作业规范）

> 📍 **体系导航**：三条内容管线之一（整卡重写存量）。判据权威：`docs/card-quality-rubric.md`（机检规则=其附录 A）；judge 校准样本：`docs/judge-calibration.md`；地图：`docs/INDEX.md`。
>
> 角色分工：**rubric 定标准**（唯一裁判），**执行 agent（Codex/GPT/任意模型）跑生成**，机检脚本 + judge 抽查裁决，不达标带理由回炉。人只看最终 diff 和 audit 数字。

## 总原则

1. **标准只有一份**：`docs/card-quality-rubric.md`。本文件只定"怎么跑"，不定"什么算好"。
2. **一次一个 deck 文件**（`src/content/<track>/<deck>.json`），改完验完再下一个。禁止跨 deck 批量 sed。
3. **直接编辑 deck JSON**（git 兜底可回滚），但**绝不改 `id`、`format`、`atomType`**——SRS 学习状态按 id 关联，改 id = 丢学习进度。
4. **cloze/chain 卡**只做 Gate 0 裁决 + `q_en`/`scenario_en`/`why`/`why_en`/`termDefinitions`/`tradeoff` 升级，不碰其结构字段。
5. 每轮改动的验证命令（全绿才算完成一个 deck）：
   ```bash
   node scripts/validate-deck.mjs src/content/<track>/<deck>.json
   node scripts/audit-card-quality.mjs src/content/<track>/<deck>.json --limit=0   # error 必须为 0
   npm run build:deck && npm run verify
   ```

## 每个 deck 的五步循环

### Step 1 · Gate 0 存在性裁决

逐卡对照 rubric Gate 0（G1 技术判断 / G2 可溯源 topic / G3 数字转设计含义 / G4 单独可答）：

- `keep`：直接进 Step 2。
- `rewrite`：违反 G3/G4 但技术内核有价值 → 进 Step 2 重写。
- `delete`：违反 G1/G2（非技术 trivia、无源 topic）→ 从 deck JSON 中移除，并在报告里列出 id + 一句理由。

### Step 2 · 逐字段重写（对照 rubric §1 的每个 S 判据）

对每张 keep/rewrite 卡，按字段顺序处理，**每个字段写完自问对应的 S/F 判据**：

1. `scenario`+`q` + **`scenario_en`/`q_en`**：约束决定答案、单独可答、≤90/40 字；英文小字必须保留同一技术约束，不做机械直译。
2. `options` + **`options_en`**（逐项对齐，自然口语）：干扰项=真实误解、长度均衡。
3. 选项解析三字段：错误项"①是什么②何时它反而赢③本题为何不选"各一句；**概念一卡只讲一遍**；number 卡**清空**选项解析；写不出就留空。
4. `why`（≤2 句）+ `tradeoff`（fit/contrast 必填"X vs Y"）+ `whenOtherWins`。
5. `why_en`（一句面试口语）+ `termDefinitions`：题干与**全部选项**中的术语，each `{term, meaning, meaningEn}`，meaningEn 独立成句可朗读。
6. **`table` 横向对比表**（rubric §1.7）：任何对 ≥2 个具名技术/组件/方案做横向比较的卡（数据库、缓存、消息队列、认证方式 JWT vs API key、协议……）必配；`{headers, rows}`——第一列=方案名，2-4 列=**区分维度**（某列全行同值=删换）；表头≤8字、单元格≤20字短语；表格保持中立（不标"最佳"，本题的选择由 why/tradeoff 说）；同一组候选在整个 deck 内用同构的行列。
7. **`codeSample`**（rubric §1.8）：判断落在具体机制的用法/格式时必配——JWT 三段结构、`Authorization` 请求头、Redis 命令、建表语句、查询 DSL；≤10 行真实格式 + 2-3 行关键参数注释；对比类卡只给正确方案的代码。
8. 整卡自查：reveal 总量 ≤420 字（table/codeSample 不计入）。

### Step 3 · 机检（observe）

跑上面的验证命令。**audit error（template_filler / fit.missing_when_other_wins / too_long 超硬上限 / explanation.truncated）任意一条 >0 → 回 Step 2**，最多两轮；两轮后仍 fail 的卡标记 `"needsHuman": true` 并继续。

### Step 4 · Judge 抽查（机器查不了的四项）

从本 deck 随机抽 **10 张**（或 ≤10% 取大者），逐卡按下表打 pass/fail + 一句理由（这就是 per-card rubric 判卷，输出 markdown 表格进报告）：

| 检查项 | 判据（rubric 编号） |
|---|---|
| 约束决定答案 | 1.1-S1：换掉 scenario 里的约束，答案会变吗？ |
| 答案泄漏 | 1.2-F2：某干扰项换个说法其实也对？ |
| 英文口语自然度 | 1.1-S6 + 1.5-S1/F1：`q_en`/`scenario_en`/`why_en`/`options_en` 像面试说的话吗？ |
| Gate 0 复核 | G1/G2：真在考一个可溯源的技术判断？ |

**≥2 张 fail 同一项 → 该项对全 deck 系统性回炉**（Step 2 只修该字段）；个别 fail → 修个别卡。

### Step 5 · 汇报（每 deck 一段）

```
deck: system-design/core-concepts_caching.json
Gate0: kept 38 / rewritten 3 / deleted 1 (sd-…-012: 非技术 trivia，考公司事实)
audit: errors 4→0, warnings 61→9（残余: answer_cue×5 …）
judge: 10 抽查 → 38/40 pass；fail: sd-…-007 answer-leak（已修）
fields: q_en 42/42 · scenario_en 17/17 · options_en 42/42 · tradeoff 17/17 fit卡 · termDefinitions 新增 31 条
verify: 全绿
```

## 批次顺序（建议）

1. **试点**：`system-design/core-concepts_caching.json`（42 张，人工全量 review 这一个 deck 的 diff，确认标准理解一致）。
2. 然后按 audit warn 密度降序跑其余 deck（`node scripts/audit-card-quality.mjs --json --limit=0` 按 file 聚合）。
3. `ai-coding/` 轨道里非技术卡密度高，Gate 0 从严。

## 给执行 agent 的启动 prompt（可直接复制）

```
你在 "…/system design learning/atoms-app" 仓库工作。任务：按规范批量重写学习卡片。

1. 先完整读这三个文件，它们是唯一标准，不要凭默认审美发挥：
   - docs/card-quality-rubric.md   （什么算好卡：Gate 0 存在性判据 + 逐字段 success/failure metrics + 讲解十二律）
   - docs/REGEN_FLOW.md            （怎么跑：五步循环、验证命令、回炉条件、汇报格式）
   - docs/AUTHORING_SPEC.md        （card JSON 的 schema 细节）

2. 本次处理 deck：src/content/system-design/core-concepts_caching.json（试点，只做这一个）。

3. 严格执行 REGEN_FLOW 五步：Gate 0 裁决 → 逐字段重写（补 q_en、scenario_en、options_en、tradeoff、termDefinitions[].meaningEn
   ——术语按语义判定：初级工程师说不清定义的缩写/协议/机制名都算，如 JWT、API key、OAuth、CDC；
   缩写术语必须带 fullName 全称展开（"CRDT" → "Conflict-free Replicated Data Type"）；
   选项解析每句≤70字且概念一卡一讲；number 卡清空选项解析；空胜于废话；
   横向对比 ≥2 个具名技术/组件/认证方式的卡必配 table——行=方案、列=区分维度、单元格短语化、
   不标最佳答案、同组候选全 deck 同构；判断落在具体机制用法/格式上的卡必配 codeSample——
   ≤10 行真实格式如 JWT 三段/Authorization 头/Redis 命令，对比卡只给正确方案的代码；
   另外四个解析形状（rubric 1.3-S5、1.4-S4/S5/S5a/S6，judge 校准样本见 docs/judge-calibration.md）：
   机制/恢复卡走完整状态链并以代价收尾；估算卡给公式+单位全称+数字的下游用途；
   延迟/QPS/GB/CPU/连接数等资源判断尽量给粗量级锚点（假设→公式→结论→设计含义）；
   "更简单/更快"必须落到具体接口参数或操作；中文解释必须像面试口语，一句一个判断，
   禁止"选择它会把排查带向…"这类 AI 文档腔；清单卡每项一句"挡什么风险/减哪里压力"）
   → 机检到 error=0 → 10 张 judge 抽查表 → 按格式汇报。

4. 硬性禁止：改 id/format/atomType；跨 deck 批量替换；为凑字段写模板句（audit 会以 error 拒收）；
   删除 Gate 0 之外的卡。

5. 完成标准：validate-deck + audit(error=0) + npm run verify 全绿，输出 Step 5 汇报。
```

试点 deck 验收通过后，把第 2 条换成下一批文件名循环即可。

## 模型档位（保质 + 省 token）

| 任务 | 模型档 | 理由 |
|---|---|---|
| 批量重写主力 | **Sonnet 级**（`claude-sonnet-5`） | rubric 已把标准写死，模型照着执行即可，不需要 Opus 级推理；质量足、更便宜快 |
| 正确性 judge 抽查（§1.2-S6，每 deck ~10 张） | **Opus 级**（`claude-opus-4-8`） | 正确性最不能省，但样本小、成本可控 |
| 纯翻译补字段（补缺失英文） | **Haiku 级**（`claude-haiku-4-5`） | 机械活，最便宜 |

用 Codex/GPT 同理：主力中高档，正确性 judge 用最强档。

## 本轮新增/收紧的标准（rubric v-next，2026-07-09）

执行 agent 读 rubric 时重点落实这几条新条目（都已在 rubric 正文）：
- §1.2-S6 **正确性 P0**（judge-only）：keyed 答案事实正确、干扰项确实错；判不准挂 `needsHuman`，绝不放行错卡。
- §1.2-S3 **长度均衡收紧**：正确项不得是严格最长；跨卡轮换谁最长（改选项时 `options`/`options_en` 同步、不改语义与顺序）。
- §1.3-S0/S1 **一句连贯、不拆三段**：每个选项写**一句自然完整的 `optionExplanations`（+ `_en`）**，把「是什么/何时更合适/本题为何不选」织进一句人话，**不要**「是什么/适用/本题」标签、**不要** optionMeanings/Directness/ScenarioImpacts 三段式（已降为 legacy，`choice.legacy_only` 已停用）。
- §1.3-S6 **选项解析正向框架**：讲「何时选它 / 从不合适就点名误解」，不写「B 不如 A」。
- §1.3-S7 **按题型匹配深度**：「识别正确原因/揪误解」型（选项对vs错）→ `why` + 每错项一句纠正即可，别逐项长篇复读同一个点；只有真·fit/contrast（选项是并列真实方案）才值得每项一句更完整的解释。
- §1.7-S6 **表格三原型**：决策矩阵 / 量级对比 / 适用场景。
- §1.8-S5 **codeSample 扩展**：真实命令 + 配置 + 必要时最小示意伪代码。
- 双语维持**全量中英**（含 `options_en` 与选项解析英文）；缺英文的选项解析视作补字段任务。
