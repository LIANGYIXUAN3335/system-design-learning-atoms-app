#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const deckPath = path.join(root, 'src', 'content', 'system-design', 'data-intensive-design.json');

const FIT_MAP = [
  [/可忍短暂滞后时用/, 'Use when brief staleness is acceptable.'],
  [/要最新读或不变量时用/, 'Use when latest reads or invariants matter.'],
  [/低频离线任务才用/, 'Use only for low-frequency offline work.'],
  [/随机写重时更顺/, 'Fits write-heavy random-update workloads.'],
  [/范围读多时更顺/, 'Fits range-heavy read workloads.'],
  [/点查多时更顺/, 'Fits point-lookup-heavy workloads.'],
  [/小规模才用/, 'Use only at small scale.'],
  [/低风险时可接受/, 'Acceptable only when the risk is low.'],
  [/强约束时考虑/, 'Consider only when that strong constraint is real.'],
  [/约束吻合时选/, 'Use when it matches the core constraint.'],
  [/多资源同提交时用/, 'Use when multiple resources must commit together.'],
  [/协同合并时用/, 'Use when collaborative merging is the real goal.'],
  [/外部调试友好/, 'Fits externally visible debugging or integration.'],
  [/自动决定时用/, 'Use when the system must decide automatically.'],
  [/仓库过滤适合/, 'Fits warehouse-style filtering.'],
  [/大扫描聚合适合/, 'Fits large scans and aggregations.'],
  [/崩溃恢复适合/, 'Fits crash-recovery paths.'],
  [/key-value 点查适合/, 'Fits key-value point lookups.'],
  [/整文档读取适合/, 'Fits whole-document reads.'],
  [/内部低延迟友好/, 'Fits internal low-latency paths.'],
  [/强不变量适合/, 'Fits strong invariants.'],
  [/后台 compaction 适合/, 'Fits background compaction work.'],
  [/固定小列查询适合/, 'Fits repeated queries over a few fixed columns.'],
  [/架构拆分适合/, 'Fits an architectural separation decision.'],
  [/企业多系统分析适合/, 'Fits analytics across multiple business systems.'],
  [/仓库建模核心/, 'Fits core warehouse modeling.'],
  [/分析切片适合/, 'Fits slicing analytics by attributes.'],
  [/星型模型必需/, 'Required for the star-schema relationship.'],
  [/宽表少列查询适合/, 'Fits wide tables that read only a few columns.'],
  [/固定维度报表适合/, 'Fits repeated reports over fixed dimensions.'],
  [/当前状态适合/, 'Fits current-state lookups, not history.'],
  [/无索引小数据才可能/, 'Only works for tiny unindexed data.'],
  [/不影响执行模型/, 'Does not change the execution model.'],
  [/不成立/, 'Does not hold for this case.'],
  [/不可取/, 'Avoid it here.'],
  [/不适合本题/, 'Does not fit this question.'],
  [/不适合分析/, 'Does not fit analytic workloads.'],
  [/不应选择/, 'Should not be chosen here.'],
  [/完全错误/, 'Incorrect for this case.'],
  [/具体引擎才评估/, 'Evaluate only for a specific engine.'],
];

const IMPACT_MAP = [
  [/守住主约束/, "It preserves the card's main constraint."],
  [/留下边界条件/, 'It leaves edge cases the design must handle.'],
  [/增加排障面/, 'It adds more operational debugging surface.'],
  [/牺牲另一侧/, 'It trades away the other side of the design.'],
  [/要兜住旧读窗口/, 'The design must tolerate stale-read windows.'],
  [/慢副本拖住写入/, 'Slow replicas can hold the write path hostage.'],
  [/要设计失效和回源/, 'The design needs invalidation and fallback reads.'],
  [/兼容检查可前移/, 'Compatibility checks can move earlier.'],
  [/读路径会很贵/, 'The read path becomes expensive.'],
  [/同步延迟会变长/, 'Synchronization delay grows.'],
  [/会有阻塞恢复成本/, 'Recovery can block and add operational cost.'],
  [/要等多数派/, 'The path must wait for a quorum.'],
  [/日志代理都看得见/, 'Logs and proxies can inspect it.'],
  [/并发意图会被覆盖/, 'Concurrent intent can be overwritten.'],
  [/不解决本题/, 'It does not solve this card.'],
  [/会误判能力/, 'It misreads what the system can do.'],
  [/会限制多对多/, 'It limits many-to-many relationships.'],
  [/会丢数据/, 'It can lose data.'],
  [/无法解释性能/, 'It cannot explain the performance behavior.'],
  [/无法解释灵活性/, 'It cannot explain the flexibility requirement.'],
  [/能提高写吞吐/, 'It can improve write throughput.'],
  [/会拖垮写入/, 'It can overload the write path.'],
  [/能降低 I\/O/, 'It can reduce I/O.'],
  [/无法解释现象/, 'It cannot explain the observed behavior.'],
  [/会误导容量/, 'It misleads capacity planning.'],
  [/避免重复扣款/, 'It avoids duplicate charging.'],
  [/会限制规模/, 'It limits scale.'],
  [/能高效回收旧值/, 'It can reclaim old values efficiently.'],
  [/能快速得到候选行/, 'It can find candidate rows quickly.'],
  [/能减少读 I\/O/, 'It can reduce read I/O.'],
  [/会低估写放大/, 'It underestimates write amplification.'],
  [/会浪费 CPU\/I\/O/, 'It wastes CPU and I/O.'],
  [/会压垮交易库/, 'It can overload the transactional database.'],
  [/能提高 CPU 效率/, 'It can improve CPU efficiency.'],
  [/会制造开销/, 'It adds overhead.'],
  [/会浪费硬件/, 'It wastes hardware capacity.'],
  [/能减少重复扫描/, 'It reduces repeated scans.'],
  [/会放大写成本/, 'It amplifies write cost.'],
  [/会浪费维护成本/, 'It wastes maintenance cost.'],
  [/能快速读汇总/, 'It makes summaries fast to read.'],
  [/无法做历史分析/, 'It cannot support historical analysis.'],
  [/不服务聚合/, 'It does not serve aggregation.'],
];

function compact(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function sentence(text) {
  const s = compact(text);
  if (!s) return '';
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

function lowerFirst(text) {
  return text ? text.slice(0, 1).toLowerCase() + text.slice(1) : text;
}

function smartTrim(text, max = 118) {
  const s = sentence(text);
  if (s.length <= max) return s;
  const parts = s.split(/[,;:]/).map(compact).filter(Boolean);
  if (parts[0] && parts[0].length <= max - 1) return sentence(parts[0]);
  const words = s.replace(/[.!?]$/, '').split(/\s+/);
  let out = '';
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > max - 1) break;
    out = next;
  }
  return sentence(out || s.slice(0, max - 1));
}

function phraseAfterColon(zh) {
  const text = compact(zh).replace(/[。.]$/, '');
  const idx = text.indexOf('：');
  return idx >= 0 ? text.slice(idx + 1) : text;
}

function mappedEnglish(zh, table) {
  const full = compact(zh);
  const suffix = phraseAfterColon(full);
  for (const [re, en] of table) {
    if (re.test(suffix) || re.test(full)) return en;
  }
  return '';
}

function optionSummary(card, index) {
  return smartTrim(card.options_en?.[index] ?? card.options?.[index] ?? 'This option', 110);
}

function optionAsCondition(optionText) {
  const option = compact(optionText).replace(/[.!?]$/, '');
  const toMatch = option.match(/^To\s+(.+)$/i);
  if (toMatch?.[1]) return `the goal is to ${lowerFirst(toMatch[1])}`;

  const imperative = option.match(
    /^(Add|Avoid|Ban|Broadcast|Build|Cache|Choose|Commit|Compute|Convert|Create|Delete|Drop|Fetch|Force|Group|Have|Ignore|Join|Keep|Let|Limit|Maintain|Mention|Monitor|Parse|Partition|Pause|Prioritize|Provide|Ramp|Read|Regularly|Rely|Replace|Replicate|Return|Run|Scan|Send|Ship|Sort|Store|Use|Validate|Wait|Write)\b(.*)$/i,
  );
  if (imperative) {
    const verb = imperative[1].toLowerCase();
    const rest = compact(imperative[2]);
    return `the goal is to ${verb}${rest ? ` ${rest}` : ''}`;
  }

  return `this statement is true: ${lowerFirst(option)}`;
}

function conditionFromWhy(whyEn) {
  const why = compact(whyEn).replace(/[.!?]$/, '');
  const directPatterns = [/^Once ([^,;]+),/i, /^When ([^,;]+),/i, /^If ([^,;]+),/i];
  for (const re of directPatterns) {
    const match = why.match(re);
    if (match?.[1]) return lowerFirst(match[1]);
  }
  const forMatch = why.match(/^For ([^,;]+),/i);
  if (forMatch?.[1]) return `${lowerFirst(forMatch[1])} is the concern`;
  const withMatch = why.match(/^With ([^,;]+),/i);
  if (withMatch?.[1]) return `${lowerFirst(withMatch[1])} is present`;
  const inMatch = why.match(/^In ([^,;]+),/i);
  if (inMatch?.[1]) return `the system runs in ${lowerFirst(inMatch[1])}`;
  const because = why.match(/\bbecause ([^.;]+)(?:[.;]|$)/i);
  if (because?.[1]) return lowerFirst(because[1]);
  return lowerFirst(why.split(/[.;]/)[0] ?? 'this constraint matters');
}

function fallbackFit(card, index) {
  const option = optionSummary(card, index).replace(/[.!?]$/, '');
  if (card.answer?.includes(index)) {
    return smartTrim(`Use when ${conditionFromWhy(card.why_en)}`, 110);
  }
  return smartTrim(`Only fits when ${optionAsCondition(option)}`, 110);
}

function fallbackImpact(card, index) {
  const option = optionSummary(card, index).replace(/[.!?]$/, '');
  if (card.answer?.includes(index)) {
    return smartTrim(`It commits the design to this path: ${option}`, 110);
  }
  return smartTrim(`It commits the design to this assumption: ${option}`, 110);
}

const cards = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
let touched = 0;
let fields = 0;

for (const card of cards) {
  if (!Array.isArray(card.options)) continue;

  if (Array.isArray(card.optionMeanings)) {
    card.optionMeanings_en = card.options.map((_, index) => optionSummary(card, index));
    touched++;
    fields++;
  }

  if (Array.isArray(card.optionDirectness)) {
    card.optionDirectness_en = card.optionDirectness.map((zh, index) =>
      mappedEnglish(zh, FIT_MAP) || fallbackFit(card, index),
    );
    touched++;
    fields++;
  }

  if (Array.isArray(card.optionScenarioImpacts)) {
    card.optionScenarioImpacts_en = card.optionScenarioImpacts.map((zh, index) =>
      mappedEnglish(zh, IMPACT_MAP) || fallbackImpact(card, index),
    );
    touched++;
    fields++;
  }
}

fs.writeFileSync(deckPath, `${JSON.stringify(cards, null, 2)}\n`, 'utf8');
console.log(`backfilled ${fields} field arrays on ${touched} updates`);
