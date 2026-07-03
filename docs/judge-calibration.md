# Judge 校准样本（few-shot · 判卷前必读）

> 📍 **体系导航**：LLM judge 打分时的对照样本——机器查不了的判据（rubric 1.3-S5、1.4-S4/S5/S6、Gate 0、答案泄漏、口语自然度）靠这里对齐。来源：用户 2026-07-03 实刷一天的 7 个典型案例。判据编号见 `docs/card-quality-rubric.md`；地图见 `docs/INDEX.md`。
>
> 用法：把本文件整体放进 judge 的 system prompt，逐卡按下列形状打 pass/fail 并给一句理由。

## 形状 1 · 机制闭环（rubric 1.4-S4）

故障恢复/生命周期/协议交互卡，必须走完"正常路径 → 异常 → 中间状态 → 恢复动作 → 代价收尾"。

- **fail**：Redis Streams 卡只说"pending idle 增长后 XCLAIM 接管"——学习者不懂 PEL、idle、XACK 是什么，链条断在中间。
- **pass**："XREADGROUP 领取任务 → 未 XACK 的条目留在 PEL → worker 死后 idle time 增长 → 其他 worker 用 XCLAIM/XAUTOCLAIM 接管重做 → 完成后 XACK。代价：可能重复执行，业务要幂等。"（链上每个术语进 termDefinitions）

## 形状 2 · 估算三件套（rubric 1.4-S5）

数字卡 = 公式 + 缩写/单位全称 + 这个数字的下游用途。

- **fail**：直接给"10k TPS、2 亿并发连接"，不解释怎么来的。
- **pass**："TPS = Transactions Per Second（每秒事务数）。并发估算：注册用户 × 同时在线比例 = 10 亿 × 20% = 2 亿并发连接。这个数字是后续算服务器数量、心跳量、轮询量的基数。"
- 补充：SLO 类数字（"<500ms"）必须注明"这是给定目标而非推导结果"，并考它约束哪条设计路径。

## 形状 3 · 形容词落地（rubric 1.4-S6）

"更简单/更快/更贵/更稳"必须指到具体接口参数、操作步骤或资源数字。

- **fail**："offset 更简单"（简单在哪？玄学）。
- **pass**："offset 简单在**接口**：只传 offset/limit 两个整数，翻页 offset += limit。cursor 则要选稳定排序键、保存上一页最后一条 commentId、做 `commentId < cursor` 范围查询。offset 的代价：高速插入/删除时数字位置错位，出现重复或漏读。"

## 形状 4 · 清单每项挡什么（rubric 1.3-S5）

multi/分层/加固/优化清单卡：每项一句"它挡住什么风险 / 把压力从哪里减掉"，不是名词翻译。

- **fail**：支付安全卡把"支付域 iframe、public-key 加密、HTTPS"当名词堆叠。
- **pass**："支付域 iframe：卡号输入框来自支付平台域名，商户 JS 读不到卡号 / 公钥加密：浏览器用平台公钥加密，只有平台私钥能解 / HTTPS：防浏览器到服务器的中间人窃听 / 不记原始卡号日志：避免日志、备份、搜索系统扩大泄露面。"
- 同形状：LeetCode 容器加固（read-only fs 防改依赖留文件 / CPU、内存 limits 防拖垮宿主机 / timeout 到点杀死循环 / no network 防外连与扫内网 / seccomp 缩小系统调用攻击面）；Postgres 写入优化（vertical scaling 提单机上限但有天花板 / batch 合并事务减少 WAL flush 但缓冲可能丢 / write offloading 异步落库但数据延迟可见 / partitioning 只维护相关分区索引 / sharding 横向分摊写但跨片查询复杂）。

## 附加两个 judge-only 检查（rubric 引用）

- **答案泄漏**（1.2-F2）：某个干扰项换个说法其实也对且题干没排除它 → fail。
- **口语自然度**（1.5-S1/F1）：`why_en`/`options_en` 读起来像面试口语（≤22 词、无堆叠从句）才 pass；翻译腔 fail。
