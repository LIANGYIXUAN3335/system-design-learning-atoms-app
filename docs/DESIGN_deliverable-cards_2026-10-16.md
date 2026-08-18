# 设计稿 · 把「感悟题」换成「能交付的设计产物」（2026-10-16，待她拍板）

她 10/16 的原话：「我们好像有很多感悟题，但其实不需要太多感悟。需要的是：具体怎么选型、为什么这么选、面试时怎么写这个选型。」
她贴来的规范（schema / API / 架构 / 状态机 / 真实选型五种选项形态 + 10 项最低覆盖合同 + recognition / production 两类卡）原文见本文末尾附录。

**最终验收问题（她的）：合上选项以后，能不能从白纸写出这个系统的 schema、API、组件和核心流程？**

---

## 1. 现状读数（只看 problem-breakdowns，31 个 deck · 2094 张）

| 读数 | 数 | 说明 |
|---|---|---|
| 格式 | mcq 1541 · multi 203 · cloze 135 · code 107 · chain 108 | 没有任何「先写后揭晓」的格式 |
| `optionDiagrams`（选项带图） | **1 张** | 字段早就有，几乎没用过 |
| 选项里有具体产物（路径 / 字段 / 主键 / 命令 / 状态名） | ≈1329 张（63%） | 粗探，按正则 |
| 纯感悟 / 原则题（为什么、目的、教训、意味着…） | ≈166 张（8%） | 例：uber-007「产品型题推荐的推进策略是？」 |
| meta 卡（达标线、方法论、需求句式） | 188 张（9%） | 例：uber-076/077/078 三张「E4/E5/Staff 达标线」 |
| 中间态 | ≈400 张 | 问的是具体机制，但选项是一句话描述（「加一层缓存」），不是 schema / endpoint |

她刷到的「感悟感」= 8% 感悟题 + 9% meta 卡 + 这 400 张「描述式选项」。

**10 项合同 dry-run**（按 sub / tag 粗探，`scripts/rigor-audit` 同款 node 一行脚本）：31 个 deck 里 **17 个至少缺一项**。
缺得最多：状态模型 10 个 deck、并发/幂等 8 个、故障恢复 4 个、核心实体 4 个、API 1 个（web-crawler）。
全缺的是 bulk-email-move（18 张的小 deck）。

**两个结构性缺口**（光改卡解决不了）：
1. 没有 production card 格式——现有 5 种格式全是「选」。
2. 没有「可交付产物」的覆盖检查——现有 `audit-coverage.mjs` 只按文章字数查密度，不管讲了什么。

好卡长什么样（已有的，照着放大）：
- uber-013 cloze：四个端点补全，`{{POST}} /fare`、body 只带 `{{fareId}}`、`{{PATCH}} /rides/:rideId`
- uber-016 mcq：`POST /rides` 的 body 传什么？A 起终点 / B 价格+ETA / C userId / D fareId
- uber-038 code：`GEOADD` + `GEOSEARCH BYRADIUS 5 km` vs ZADD / SADD
- uber-043 chain：位置存储选型决策链排序

坏卡长什么样（要换掉的）：
- uber-007「产品型系统设计题推荐的整体推进策略是什么？」——方法论，不是设计
- uber-076「Uber 题对 E4 的达标线是什么？」——面试官视角的评分表，背了也写不出系统
- uber-047「自适应上报这个深挖给出的更普遍的设计教训是什么？」——感悟

---

## 2. 改法：三层，按顺序

### A. 格式层（改代码，一次性，约 1 天）

**A1 新格式 `produce`（先写后揭晓）**
```jsonc
{
  "id": "sd-problem-breakdowns-uber-p01",
  "format": "produce",
  "atomType": "fit",
  "deliverable": "schema",                  // 见 A3
  "scenario": "Uber：乘客估价→请求→匹配司机→司机接单。",
  "q": "在纸上写出 Ride / Fare / Location 三个 entity，各自的主键、查询键，以及 Ride 的状态字段取值。",
  "q_en": "On paper, write the Ride, Fare and Location entities: primary key, query key, and the Ride status values.",
  "checklist": [                            // 3–5 条，可当场判真假
    "三个 entity 都写了主键（rideId / fareId / driverId）",
    "Location 的查询键是地理位置，不是 driverId（要支持 nearby 查询）",
    "Ride.status 至少 4 个状态且含 REQUESTED→MATCHED→ACCEPTED→COMPLETED",
    "Fare 和 Ride 之间是 1:1，Ride 引用 fareId 而不是复制价格"
  ],
  "codeSample": "Fare { fareId PK, riderId, pickup, destination, estimatedFare, eta }\nRide { rideId PK, fareId FK(1:1), riderId, driverId?, status: REQUESTED|MATCHED|ACCEPTED|IN_PROGRESS|COMPLETED|CANCELLED, createdAt }\nLocation { driverId PK, lat, lng, updatedAt }  -- 实时位置进 Redis GEO，按坐标查\n",
  "lang": "text",
  "why": "面试里 entity 一栏 2 分钟要写完：先主键、再查询键、再状态字段。Location 单独拆出来是因为它的查询键（坐标）和写入频率（5 秒一次）都和 Ride 完全不同。",
  "why_en": "Write primary key, query key and status field for each entity; Location is split out because its query key and write rate differ from Ride.",
  "tags": ["uber", "d:schema", "produce"]
}
```
- 做题：只显示 scenario + q，一个「我写好了 →」按钮（可选软计时 3–5 分钟）。
- 揭晓：参考答案（codeSample / diagram）+ checklist 逐条打勾 → 打了几勾就是分（落库 `checked/total`），再接现有 self-grade（forgot / fuzzy / got）。
- 自动判分不做（她 10/11 在重做网页也拍板「自查保留人工打勾」）。将来可以加「拍照 / 粘贴 → Claude 判」，不在这一期。
- 改动点（照「加 track 要动 5 处」的教训先列全）：`src/types.ts`（CardFormat + checklist + deliverable）、`scripts/validate-deck.mjs`（produce 必须有 checklist 3–5 条 + codeSample 或 diagram）、`scripts/build-deck.mjs`、`src/screens/SessionScreen.tsx`（isChoice 分支 + 新 `ProduceView`）、`src/components/RevealBlock.tsx`（checklist 打勾）、`audit-card-quality.mjs`（produce 跳过选项类规则）、`AUTHORING_SPEC.md`。

**A2 `optionDiagrams` 用起来**：选项是架构 / 数据流 / 状态机时必须带小 Mermaid 图（规范里早写了，只用过 1 张）。validate 加一条软警告：`d:components` 的 mcq 没 optionDiagrams 就提示。

**A3 新字段 `deliverable`**（或 tag `d:xxx`，二选一，推荐独立字段，机检好写）：
`entities | schema | api | components | flow | state | concurrency | recovery | scaling | tech`。
每张 problem-breakdown 卡标一个；没法标的（达标线、方法论）就是该删的信号。

### B. 合同与机检层（脚本，半天）

- `scripts/audit-deliverables.mjs <deck>`：按 10 项合同出 coverage report，缺的标 **MISSING**；每个 `deliverable` 至少 1 张 recognition（mcq/multi/cloze/code/chain）+ 至少 1 张 produce，缺的标 **NO_PRODUCTION**；meta 卡（达标线 / 方法论 / 需求句式）超过 deck 的 5% 标 **META_HEAVY**。
- 进验收门：`AUTHORING_SPEC.md`「验收门」加第 4 门；`feedback-loop` 改卡时同样跑。
- 规则写进 `card-quality-rubric.md` 当 Gate 4，和 rigor 的 Gate 3 并列：**不得用通用设计原则卡代替合同项；选型题必须落到「放在哪个组件后、存什么、按什么 key 查、坏了怎么办、什么条件下换方案」**。

### C. 内容层（agent 批量，她选档）

| 档 | 做什么 | 新卡 | 动旧卡 | 模型 / token | 时间 |
|---|---|---|---|---|---|
| **C1 只补** | 每 deck 按 MISSING 补 recognition + 每个 deliverable 1 张 produce | ≈31×12 ≈ 370 | 不动 | Opus 写（产物要准）≈ 400–500 万 | 1 晚 |
| **C2 补 + 清**（推荐） | C1 + 删 188 张 meta 卡（每 deck 留 1 张合并版「这题 E4/E5 看什么」）+ 166 张感悟题逐张判：能改成具体选型的改、不能的删 | ≈370 | 删/改 ≈350 | ≈ 700–900 万 | 2 晚 |
| C3 按合同重写 | 31 个 deck 从文章重做，每 deck ≈60 张按合同配比 | ≈2000 | 全换 | ≈ 4000–5000 万 | 4–5 天 |

C3 不推荐：刚审完改好的 1874 张里 problem-breakdowns 占大头，重写等于丢掉一半成果；而且文章本身给的产物（entities / API / 架构图 / 深挖）C1 就能覆盖完。
**deep-dives / patterns / core-concepts 不动**：合同是给「一道题」的，技术机制 deck 不适用；它们的感悟题比例也低（rigor 审计 PASS 率 81%）。

**先试 2 个 deck**（Uber + Ticketmaster，她最熟、文章最全）：补完她刷一遍，说行再放 29 个。按 [[batch-cost-estimate-first]] 的规矩，>5 个 agent 前先报数等点头。

### 练习入口（她要定）

produce 卡一张 3–5 分钟，混在 30 秒一张的 mcq 流里会打断节奏。两种放法：
- **单独模式「✍️ 白纸」**（推荐）：TodayScreen 加一个按钮，选一个题目（deck），按顺序出它的 produce 卡（entities → schema → API → 组件图 → 主流程 → 状态机 → 并发 → 恢复），一轮 ≈15–20 分钟 = 一次完整的「白纸写一遍 Uber」。
- 混排：普通 session 每 10 张插 1 张 produce。

---

## 3. 要她拍的 4 件事

1. **范围**：只动 problem-breakdowns 31 个 deck？（deep-dives / patterns 不动）
2. **内容档位**：C1 / C2 / C3？（推荐 C2）
3. **produce 卡入口**：单独「✍️ 白纸」模式，还是混排？（推荐单独）
4. **试点**：Uber + Ticketmaster 先做、她刷过再放量？

拍完的顺序：A 格式层（1 天）→ B 机检（半天）→ 试点 2 个 deck → 她刷 → 放量 → build:deck + 部署网页（手机包另说）。

---

## 附录 · 她贴来的规范原文（2026-10-16）

> 卡片不能只考技术名词，必须覆盖可交付的设计产物。System Design 面试要求候选人现场产出设计，而不只是识别原则。因此 ABCD 选项可以并且应该包含具体的候选设计。
>
> 优先使用以下选项形态：
> 1. **Schema 选项**：entity 划分、表结构、主键、partition key、secondary index、relationship、状态字段、version 字段、normalized / denormalized、conditional update、event/history 表。不要问「schema 很重要吗」，应提供访问模式、写入模式和一致性要求，让学习者选具体 schema。每个 problem-breakdown 必须检查是否覆盖：核心 entities、entity 关系、关键字段、主键与查询键、状态模型、必要索引、一条重要 schema trade-off。
> 2. **API / URL 选项**：直接给出候选 API contract（`POST /rides`、`GET /rides/{rideId}`、`POST /rides/{rideId}/accept`、`GET /drivers/nearby?lat=&lng=`），比较 HTTP method、resource naming、request/response 字段、idempotency key、pagination、async job status、error semantics、authn/authz、API 与状态转换的对应。不要问「API 应该 RESTful 吗」，应问在给定重试、并发、分页或异步约束下哪个具体接口更可靠。
> 3. **Server architecture 选项**：不同的组件拆分或数据流（Client → API Gateway → Ride Service → Matching Service → Location Index → Trip DB → Notification）。重点考：哪个服务拥有哪份状态、read/write path、同步与异步边界、cache/queue/db/worker 的位置、谁能无状态扩容、谁是热点、故障后从哪恢复。选项代表架构时优先用 `optionDiagrams`，不要把架构压成一句口号。
> 4. **Sequence / state-machine 选项**：不同的执行顺序（SEARCHING → DRIVER_RESERVED → ACCEPTED → PICKED_UP → COMPLETED）或请求流程（查候选司机 → 原子预留 → 写 trip → 发通知 → 超时释放）。重点考竞态、超时、重试、补偿、权威状态。
> 5. **真实技术选型**：DB / Redis / Kafka / WebSocket / SSE / CDN 仍要考，但必须落在具体设计里：放在哪个组件后、存什么、按什么 key 查、正常路径、故障后怎么办、替代方案为何不合适、条件变了何时切换。禁止只问「哪个技术更 scalable」。
>
> **每个 problem-breakdown 的最低覆盖合同**（教材给了信息的前提下）：① 一组核心 entities ② 一个具体 schema 决策 ③ 一个 API contract 决策 ④ 一张高层组件图 ⑤ 一条端到端主流程 ⑥ 一条核心状态转换 ⑦ 一个并发或幂等问题 ⑧ 一个故障恢复闭环 ⑨ 一个 scaling bottleneck ⑩ 教材中每个主要技术选型及 trade-off。缺任何一项在 coverage report 标 `MISSING`，不得用「通用设计原则」卡代替。
>
> **防止只会选、不会写**：每个重要设计主题至少 Recognition card（从多个真实候选 schema / API / 流程 / 架构中选）+ Production card（先在纸上写出 schema / endpoint / 状态机 / 组件图，再看参考答案）。Production card 必须有可验收结果：写出 3 个 entity 及主键；3 个 endpoint 和关键请求字段；画 5 个组件及箭头；4 个状态和合法转换；一条条件更新语句；讲清正常、超时、重试、恢复四段流程。schema 不能自动判自由回答时可用 `code` / `chain` 承载，或标成明确的「先写后揭晓」练习；不得因实现方便把所有内容降级成简单 MCQ。
