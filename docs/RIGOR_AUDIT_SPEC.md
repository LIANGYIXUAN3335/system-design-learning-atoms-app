# Technical Rigor Audit —— 题库技术严谨性审计规范

> 2026-10-15 她给的规范，原文照录（下面「运行约定」是实施补充）。
> 用途：批量审查 System Design 卡片的事实准确性、题面完整性、答案唯一性。先出报告，不改源文件；人工确认后才出最小 patch。
> 和 `docs/card-quality-rubric.md` 的分工：那份管字段格式和表达质量；这份管「技术上对不对、答案唯一不唯一」。

## 运行约定（实施补充，2026-10-15 她拍板）

- 范围：全量只跑 `classic-sd` 轨道；题型 `mcq` + `multi` + `cloze`（排序 chain、代码 code 不管）。
- 试跑：「带练·API设计」+「API Design」+「Distributed Rate Limiter」三个模块，126 张，5 批。
- 审计员：`.claude/agents/rigor-auditor.md`（Opus，推理强度 low，只给 Read/Write/Glob/Grep）。
- 分批：`node scripts/rigor-audit/make-batches.mjs --run <run-id> [--categories ...]` → `reports/rigor-audit/<run-id>/batches/batch-NN.json` + `manifest.json`。
- 报告：每批一份 `reports/rigor-audit/<run-id>/reports/batch-NN.md`，格式见下文「审计输出格式」；PASS 的卡只在汇总里计数，不单独写段落。
- 第二阶段 patch 走和 feedback-loop 一样的闸门：只改确认过的卡、`validate-deck` + `audit-card-quality` 过了才留。

---

你是一名资深 System Design 面试官、分布式系统工程师和技术教材审校员。请批量审查当前题库中的 System Design MCQ 卡片，校准其事实准确性、题面完整性和答案唯一性。
运行配置：

* Model：Claude Opus
* Reasoning effort：low
* Batch size：每批 20–30 张
* 先生成审计报告，不要直接修改源文件
* 得到人工确认后，才生成最小修改 patch

核心原则
把题库提供的正确答案视为一个待验证的假设，而不是 ground truth。
每张卡必须满足：
读者只根据 scenario 和选项，不看答案解释，也能推出唯一最佳答案。
不得依靠解释区补充题面缺失的关键前提。
审查目标
逐张检查：

1. 技术事实是否准确。
2. 题面是否包含推出答案所需的全部前提。
3. 是否有两个或更多合理答案。
4. 正确答案是否依赖隐藏假设。
5. 是否把常见实现误写成协议保证或唯一设计。
6. 是否把"可以这样设计"写成"必须这样设计"。
7. HTTP、REST、SSE、WebSocket、数据库、缓存、消息队列和分布式系统术语是否准确。
8. 是否混淆网络状态、业务状态、用户可见状态和审计事实。
9. 容量、QPS、复杂度和存储结论是否说明必要的 workload assumptions。
10. 中文和英文题面、选项及解释是否表达相同约束。
11. 干扰项是否明确错误，而不是仅仅"不如标准答案常见"。
12. 题目是否适合作为只有一个最佳答案的 MCQ。

独立审核流程
对每张卡严格按以下顺序执行：

1. 隐藏题库答案和解释。
2. 独立回答问题。
3. 列出选择该答案所需的全部假设。
4. 检查这些假设是否明确出现在 scenario 中。
5. 判断其他选项在合理解释下是否也能成立。
6. 再查看题库答案和解释。
7. 比较独立答案与题库答案。
8. 如果不一致，判断是审核错误，还是题目存在歧义或事实错误。
9. 根据 rubric 打分。
10. 标记为 `PASS`、`MINOR` 或 `MAJOR`。

不要为了替原答案辩护而补充题目没有给出的条件。
Technical Rigor Rubric
每项 `0–2` 分：
1. 事实正确性

* `0`：存在技术错误。
* `1`：方向基本正确，但明显过度简化。
* `2`：技术准确。

2. 前提完整性

* `0`：缺少决定答案的关键前提。
* `1`：存在轻微隐含假设。
* `2`：所需前提全部出现在题面。

3. 答案唯一性

* `0`：多个选项合理成立。
* `1`：原答案只是勉强更好。
* `2`：存在唯一最佳答案。

4. 标准与术语

* `0`：混淆概念或不符合标准。
* `1`：工程口语可理解，但不够严谨。
* `2`：协议、术语和层次准确。

5. 选项质量

* `0`：干扰项也可能正确，或者选项不在同一维度。
* `1`：部分选项过于明显或范围不一致。
* `2`：选项边界清楚且只有一个最佳答案。

6. 解释质量

* `0`：解释偷加前提或循环论证。
* `1`：答案方向正确，但解释不完整。
* `2`：解释能够直接由题面推出答案。

7. 中英文一致性

* `0`：两种语言含义或范围明显不同。
* `1`：存在轻微语气、范围或条件差异。
* `2`：语义和约束一致。

通过条件：

```
总分至少 12/14
并且没有任何 Hard Fail
```

分类规则：

* `PASS`：满足通过条件，不需要修改。
* `MINOR`：方向正确，但措辞绝对、解释不完整或存在轻微术语问题。
* `MAJOR`：缺少关键前提、答案不唯一、事实错误或层次严重混淆。

Hard Fail
出现以下任一情况，必须返工：

* 正确答案依赖解释区才出现的前提。
* 两个或更多选项在合理解释下成立。
* 第一次请求是否成功、任务是否仍在运行等关键状态没有说明。
* 混淆业务超时、执行超时、网络超时和等待超时。
* 混淆 authoritative state、user-visible state、attempt history 和 audit log。
* 把常见工程实践说成协议强制要求。
* 把一种可行架构说成唯一正确架构。
* 使用 `always`、`never`、`must`，但没有标准或题面约束支持。
* 把经验容量或 benchmark 数字写成普遍真理。
* 中文和英文版本给出了不同条件。
* 必须先看答案解释，才能判断题目在问什么。
* 答案仅仅因为"参考架构这样画"而成立。

已知问题模式
请将以下内容作为 seed cases，并扫描整个题库中的同类问题。
1. Version PUT 与幂等
如果题目希望答案是"重试返回 409"，必须明确：

* 客户端此前通过 GET 获得 `version=3`；
* 第一次 PUT 已在服务端成功执行；
* 服务端把 version 从 3 增加到 4；
* 第一次响应只是在网络中丢失；
* 客户端随后原样重试 version=3。

如果第一次请求没有到达服务端，重试仍可能成功并返回 200。
同时注意：

* 业务 version 冲突经常返回 409；
* `ETag + If-Match` 失败通常更适合 412；
* 幂等表示重复请求不会产生额外的预期状态变化，不代表响应必须完全相同。

2. 不同 timeout 被混为一谈
必须区分：

* 用户代码超过执行时间上限；
* Worker lease 或业务 deadline 到期；
* Submission Service 等待回调超时；
* 原始 HTTP 请求等待超时；
* 客户端主动断开。

如果只是 HTTP 等待超时，任务可以保持 `PENDING/RUNNING`，接口返回：

```
202 Accepted + submissionId
```

后续结果通过轮询、SSE 或 WebSocket 获取。
如果业务 deadline 已到并进入终态，迟到 callback 不得覆盖权威状态，但仍可以写入内部 audit log。
3. REST 与 RESTful 的伪定义
不要未经说明声称：
REST 是宽松集合，RESTful 是满足全部约束的严格子集。
更准确的表述是：

* REST 是架构风格；
* RESTful 表示遵循 REST 风格；
* "REST API"和"RESTful API"在工程语境中经常作为近义词使用。

例如：

```
POST /models/importMarket
```

可以评价为：

```
HTTP-based but RPC-like
```

不能仅凭动词路径武断地建立"REST 与 RESTful 的严格包含关系"。
4. 存储选型由单个数字决定
不要只根据"单文档 1MB"决定 DB 或 S3。
必须综合考虑：

* 单对象大小；
* 总容量；
* 副本数；
* 快照和版本历史；
* 更新与读取模式；
* 事务需求；
* 查询需求；
* 数据库缓存、复制、备份、恢复和 vacuum 成本；
* CDN；
* 生命周期管理；
* 存储成本。

关系型数据库可以保存 1TB，不代表数据库一定是最佳选择；对象存储可用，也不代表必须使用。
5. 用户可见状态被当成唯一事实
必须区分：

* authoritative business state；
* user-visible state；
* worker execution result；
* execution-attempt history；
* audit log。

迟到结果可能不能覆盖业务终态，但仍可能需要进入审计记录。不要把"不显示给用户"写成"系统必须彻底丢弃事实"。
6. 异步任务中的 HTTP response
不要声称 Submission Service 一定保留原始 HTTP 请求，等待 worker 完成后再"回包"。
更典型的流程是：

```
POST /submissions
→ 202 Accepted + submissionId
→ GET 轮询，或 SSE/WebSocket 推送
```

消息队列通常不认识浏览器连接，但 result queue 可以由后端 consumer 消费，再通过 notification、SSE 或 WebSocket 层通知客户端。
7. 经验数字被写成固定容量
检查以下类型的绝对结论：

* PostgreSQL 固定支持某个 QPS/TPS；
* Redis 单节点固定支持某个 QPS；
* SSD 必然快固定倍数；
* 达到固定 MB 数才应该使用对象存储；
* 固定核数必然对应固定 QPS。

容量估算必须说明依赖：

* CPU 和磁盘；
* payload 大小；
* 查询复杂度；
* 索引；
* transaction 和 durability 配置；
* 网络；
* 并发；
* 缓存命中率；
* benchmark 方法。

修改原则

* 优先补全 scenario，而不是在解释里补前提。
* 不要把所有题都改成"视情况而定"；应增加足够约束，使答案唯一。
* 区分：
   * protocol guarantee；
   * common implementation；
   * design recommendation；
   * problem-specific decision。
* 保留原卡片的教学目标和难度。
* 保留现有 card ID。
* 中文和英文必须同步修改。
* 不要修改无关字段和排版。
* 不要删除本来正确的内容。
* 对 `MINOR` 和 `MAJOR` 生成修订稿，但未经确认不得覆盖源文件。
* 优先做最小修复，不要无必要地重写整张卡。

权威来源
涉及相关主题时优先核对：

* HTTP Semantics：RFC 9110
* HTTP Caching：RFC 9111
* REST：Roy Fielding dissertation
* WebSocket：RFC 6455
* SSE / EventSource：WHATWG 或 MDN
* PostgreSQL：官方文档
* Redis / Redis Streams：官方文档
* AWS S3：官方文档
* 使用到的具体数据库、消息队列或云服务的官方文档

不要把博客或面经作为唯一技术依据。
审计输出格式
不要首先修改文件。为每张 `MINOR` 或 `MAJOR` 卡输出：

```
## <card-id>

Severity: MINOR | MAJOR
Category: ambiguity | factual-error | hidden-assumption | false-absolute | terminology | non-unique-answer | bilingual-mismatch

Scores:
- Factual correctness: 0–2
- Premise completeness: 0–2
- Answer uniqueness: 0–2
- Standards and terminology: 0–2
- Option quality: 0–2
- Explanation quality: 0–2
- Bilingual consistency: 0–2
- Total: X/14

### Independent answer
...

### Required assumptions
- ...

### Original answer
...

### Problem
- ...

### Why it is misleading
...

### Revised scenario

中文：
...

English:
...

### Revised options

A. ...
B. ...
C. ...
D. ...

### Best answer
...

### Revised explanation

中文：
...

English:
...

### Sources
- 官方标准或文档
```

最后输出汇总：

```
Scanned:
PASS:
MINOR:
MAJOR:
Hard fails:
Files requiring changes:
```

并单独汇总重复出现的问题模式：

```
Repeated issue:
Affected card IDs:
Recommended generator/rubric change:
```

执行阶段
第一阶段：

* 每批扫描 20–30 张卡；
* 只输出审计报告；
* 不修改源文件。

第二阶段，收到人工确认后：

* 仅修改已确认的 `MINOR` 和 `MAJOR`；
* 生成最小 patch；
* 运行现有 schema validation、tests 和题库构建流程；
* 报告修改文件、测试结果及仍需人工判断的问题。

最终目标不是让文案听起来更专业，而是确保：
每道题事实正确、前提完整、答案唯一，并且解释能够由题面直接推出。
