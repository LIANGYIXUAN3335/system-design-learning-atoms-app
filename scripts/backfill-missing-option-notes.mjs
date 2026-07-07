#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const files = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

if (files.length === 0) {
  console.error('usage: node scripts/backfill-missing-option-notes.mjs <deck.json> [more.json]');
  process.exit(1);
}

const NUMERIC_CHOICE_RE =
  /^(?:约\s*)?(?:~|≈)?\s*(\d[\d,.]*|[一二三四五六七八九十百千万亿]+)\s*(万|亿|k|m|b|ms|s|秒|分钟|小时|天|年|DAU|QPS|RPS|TPS|req\/s|RCU|WCU|KB|MB|GB|TB|%|个|次|条|行|用户|商品)?/i;

function compact(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function sentenceZh(text) {
  const s = compact(text);
  if (!s) return '';
  return /[。.!?！？]$/.test(s) ? s : `${s}。`;
}

function sentenceEn(text) {
  const s = compact(text);
  if (!s) return '';
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

function trimWords(text, max = 110) {
  const s = compact(text);
  if (s.length <= max) return s;
  const parts = s.split(/[,;:，。；：]/).map(compact).filter(Boolean);
  if (parts[0] && parts[0].length <= max) return parts[0];
  return `${s.slice(0, max - 1)}…`;
}

function lowerFirst(text) {
  return text ? text.slice(0, 1).toLowerCase() + text.slice(1) : text;
}

function optionZh(card, index, max = 52) {
  return trimWords(card.options?.[index] ?? '', max).replace(/[。.!?！？]$/, '');
}

function optionEn(card, index, max = 104) {
  return trimWords(card.options_en?.[index] ?? card.options?.[index] ?? 'This option', max).replace(/[.!?]$/, '');
}

function conditionFromWhyEn(whyEn) {
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
  const because = why.match(/\bbecause ([^.;]+)(?:[.;]|$)/i);
  if (because?.[1]) return lowerFirst(because[1]);
  return lowerFirst(why.split(/[.;]/)[0] ?? 'this constraint matters');
}

function optionAsConditionEn(text) {
  const option = compact(text).replace(/[.!?]$/, '');
  const toMatch = option.match(/^To\s+(.+)$/i);
  if (toMatch?.[1]) return `the goal is to ${lowerFirst(toMatch[1])}`;
  const imperative = option.match(
    /^(Accept|Add|Assume|Avoid|Ban|Broadcast|Build|Cache|Choose|Commit|Compute|Convert|Create|Delete|Drop|Fetch|Force|Group|Have|Ignore|Join|Keep|Let|Limit|Load|Maintain|Mention|Monitor|Parse|Partition|Pass|Pause|Prioritize|Provide|Ramp|Read|Regularly|Rely|Replace|Replicate|Return|Run|Scan|Send|Ship|Start|Store|Use|Validate|Wait|Work|Write)\b(.*)$/i,
  );
  if (imperative) {
    const verb = imperative[1].toLowerCase();
    const rest = compact(imperative[2]);
    return `the goal is to ${verb}${rest ? ` ${rest}` : ''}`;
  }
  return `this statement is true: ${lowerFirst(option)}`;
}

function hasAnyOptionNotes(card) {
  return ['optionMeanings', 'optionDirectness', 'optionScenarioImpacts', 'optionExplanations'].some(
    (key) => Array.isArray(card[key]) && card[key].some((value) => compact(value)),
  );
}

function completeStringArray(card, key) {
  const n = Array.isArray(card.options) ? card.options.length : 0;
  return Array.isArray(card[key]) && card[key].length === n && card[key].every((value) => compact(value));
}

function hasCompleteLegacyOptionNotes(card) {
  return completeStringArray(card, 'optionExplanations') && completeStringArray(card, 'optionExplanations_en');
}

function isChoice(card) {
  return card.format === 'mcq' || card.format === 'multi' || card.format === 'code';
}

function isMostlyNumericChoiceCard(card) {
  if (!Array.isArray(card.options) || card.options.length === 0) return false;
  const numericOptions = card.options.filter((option) => NUMERIC_CHOICE_RE.test(compact(option))).length;
  return numericOptions >= Math.max(2, Math.ceil(card.options.length * 0.6));
}

function shouldSkipOptionNotes(card) {
  return card.atomType === 'number' && isMostlyNumericChoiceCard(card);
}

function zhMeaning(card, index) {
  const option = optionZh(card, index);
  if (/Redis|Kafka|DynamoDB|Cassandra|PostgreSQL|MySQL|S3|CDN|Elasticsearch|Neo4j|WebSocket|SSE|HTTP|gRPC|JWT|OAuth/i.test(option)) {
    return sentenceZh(`方案是 ${option}`);
  }
  return sentenceZh(`选项主张：${option}`);
}

function zhDirectness(card, index) {
  const option = optionZh(card, index);
  const correct = card.answer?.includes(index);
  if (correct) {
    if (/为什么|为何|缺陷|问题|风险|代价/.test(`${card.q} ${card.q_en ?? ''}`)) {
      return '这是本题要识别的核心原因。';
    }
    return '适合本题给出的约束。';
  }
  if (/只|必须|一定|永远|完全|所有|全部|唯一|无需|不需要|不能/.test(option)) {
    return '只有这个绝对假设成立时才适合。';
  }
  if (/Redis|缓存|cache/i.test(option)) return '适合临时加速或可容忍短暂旧值。';
  if (/Kafka|queue|队列|pub.?sub|stream/i.test(option)) return '适合异步解耦或事件流场景。';
  if (/PostgreSQL|MySQL|SQL|关系|事务/i.test(option)) return '适合强事务或关系查询更重要时。';
  if (/DynamoDB|Cassandra|NoSQL|KV|key/i.test(option)) return '适合按 key 高吞吐访问。';
  if (/CDN|S3|Blob|对象存储/i.test(option)) return '适合静态内容或大对象分发。';
  if (/WebSocket|SSE|HTTP|gRPC/i.test(option)) return '适合通信约束正好匹配时。';
  return '只有题设改成这个方向时才适合。';
}

function zhImpact(card, index) {
  const option = optionZh(card, index);
  if (card.answer?.includes(index)) {
    return sentenceZh(`会让方案围绕「${option}」展开`);
  }
  return sentenceZh(`会让系统依赖「${option}」这个前提`);
}

function enMeaning(card, index) {
  return sentenceEn(optionEn(card, index));
}

function enDirectness(card, index) {
  const option = optionEn(card, index);
  const correct = card.answer?.includes(index);
  if (correct) {
    if (/rule out|ruled out|exclude/i.test(`${card.q_en ?? ''} ${card.q ?? ''}`)) {
      return 'This is what the stated constraint rules out.';
    }
    if (/why|flaw|risk|problem|cost/i.test(`${card.q_en ?? ''} ${card.q ?? ''}`)) {
      return 'This is the core issue in this scenario.';
    }
    return sentenceEn(`Use when ${conditionFromWhyEn(card.why_en)}`);
  }
  return sentenceEn(`Only fits when ${optionAsConditionEn(option)}`);
}

function enImpact(card, index) {
  const option = optionEn(card, index);
  if (card.answer?.includes(index)) {
    return sentenceEn(`It commits the design to this path: ${option}`);
  }
  return sentenceEn(`It commits the design to this assumption: ${option}`);
}

let totalCards = 0;
for (const rel of files) {
  const deckPath = path.isAbsolute(rel) ? rel : path.join(root, rel);
  const cards = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
  let cardsTouched = 0;

  for (const card of cards) {
    if (!isChoice(card) || shouldSkipOptionNotes(card) || hasCompleteLegacyOptionNotes(card) || !Array.isArray(card.options)) continue;

    let touched = false;
    if (!completeStringArray(card, 'optionMeanings')) {
      card.optionMeanings = card.options.map((_, index) => zhMeaning(card, index));
      touched = true;
    }
    if (!completeStringArray(card, 'optionDirectness')) {
      card.optionDirectness = card.options.map((_, index) => zhDirectness(card, index));
      touched = true;
    }
    if (!completeStringArray(card, 'optionScenarioImpacts')) {
      card.optionScenarioImpacts = card.options.map((_, index) => zhImpact(card, index));
      touched = true;
    }
    if (!completeStringArray(card, 'optionMeanings_en')) {
      card.optionMeanings_en = card.options.map((_, index) => enMeaning(card, index));
      touched = true;
    }
    if (!completeStringArray(card, 'optionDirectness_en')) {
      card.optionDirectness_en = card.options.map((_, index) => enDirectness(card, index));
      touched = true;
    }
    if (!completeStringArray(card, 'optionScenarioImpacts_en')) {
      card.optionScenarioImpacts_en = card.options.map((_, index) => enImpact(card, index));
      touched = true;
    }
    if (touched) cardsTouched++;
  }

  if (cardsTouched > 0) fs.writeFileSync(deckPath, `${JSON.stringify(cards, null, 2)}\n`, 'utf8');
  totalCards += cardsTouched;
  console.log(`${path.relative(root, deckPath)}: ${cardsTouched} cards`);
}

console.log(`total: ${totalCards} cards`);
