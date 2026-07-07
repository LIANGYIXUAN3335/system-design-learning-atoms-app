#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const files = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const force = process.argv.includes('--force');

if (files.length === 0) {
  console.error('usage: node scripts/backfill-option-note-english.mjs <deck.json> [more.json] [--force]');
  process.exit(1);
}

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

function optionSummary(card, index) {
  return smartTrim(card.options_en?.[index] ?? card.options?.[index] ?? 'This option', 110);
}

function optionAsCondition(optionText) {
  const option = compact(optionText).replace(/[.!?]$/, '');
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
  const because = why.match(/\bbecause ([^.;]+)(?:[.;]|$)/i);
  if (because?.[1]) return lowerFirst(because[1]);
  return lowerFirst(why.split(/[.;]/)[0] ?? 'this constraint matters');
}

function directnessFromZh(zh, card, index) {
  const text = compact(zh);
  if (/签名校验|无法冒充/.test(text)) {
    return 'It fits because the signed token prevents impersonation.';
  }
  if (card.answer?.includes(index)) {
    if (/致命伤|症结|原因|本质|正是|核心|关键/.test(text)) {
      return 'This is the core issue in this scenario.';
    }
    if (/适合|匹配|推荐|正合适|涵盖|各司其职|对应|清晰|准确/.test(text)) {
      return 'This matches the scenario constraint.';
    }
    return smartTrim(`Use when ${conditionFromWhy(card.why_en)}`, 110);
  }
  if (/伪造|篡改|改写|不可信|没有防篡改|明文 cookie|自填/.test(text)) {
    return 'It is unsafe because the client can tamper with it.';
  }
  if (/方向反|说反|相反|错位/.test(text)) {
    return 'It points in the wrong direction for this flow.';
  }
  if (/不是|不属于|无关|错误|误解|不符合|不可|无法|不能|不会|不该|不需要/.test(text)) {
    return 'It does not fit this scenario constraint.';
  }
  if (/浪费|过早|容易|拖慢|返工|空转|压力/.test(text)) {
    return 'It is the wrong tradeoff for this scenario.';
  }
  if (/正确|正是|推荐|关键|契合|符合|涵盖|清晰|准确|本质|适合|匹配/.test(text)) {
    return 'This matches the scenario constraint.';
  }
  return smartTrim(`Only fits when ${optionAsCondition(optionSummary(card, index))}`, 110);
}

function scenarioImpactFromZh(zh, card, index) {
  const text = compact(zh);
  if (/丢|漏|错|压垮|暴露|重复|浪费|扩大|伤害|拖垮|制造/.test(text)) {
    return smartTrim(`It creates this risk here: ${optionSummary(card, index)}`, 110);
  }
  if (card.answer?.includes(index)) {
    return smartTrim(`It commits the design to this path: ${optionSummary(card, index)}`, 110);
  }
  return smartTrim(`It commits the design to this assumption: ${optionSummary(card, index)}`, 110);
}

function shouldBackfill(card, zhKey, enKey) {
  if (!Array.isArray(card[zhKey]) || !Array.isArray(card.options)) return false;
  return force || !Array.isArray(card[enKey]) || card[enKey].length !== card.options.length;
}

let totalCards = 0;
let totalFields = 0;

for (const rel of files) {
  const deckPath = path.isAbsolute(rel) ? rel : path.join(root, rel);
  const cards = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
  let cardsTouched = 0;
  let fieldsTouched = 0;

  for (const card of cards) {
    let touched = false;
    if (shouldBackfill(card, 'optionMeanings', 'optionMeanings_en')) {
      card.optionMeanings_en = card.options.map((_, index) => optionSummary(card, index));
      touched = true;
      fieldsTouched++;
    }
    if (shouldBackfill(card, 'optionDirectness', 'optionDirectness_en')) {
      card.optionDirectness_en = card.optionDirectness.map((zh, index) => directnessFromZh(zh, card, index));
      touched = true;
      fieldsTouched++;
    }
    if (shouldBackfill(card, 'optionScenarioImpacts', 'optionScenarioImpacts_en')) {
      card.optionScenarioImpacts_en = card.optionScenarioImpacts.map((zh, index) => scenarioImpactFromZh(zh, card, index));
      touched = true;
      fieldsTouched++;
    }
    if (touched) cardsTouched++;
  }

  if (cardsTouched > 0) fs.writeFileSync(deckPath, `${JSON.stringify(cards, null, 2)}\n`, 'utf8');
  totalCards += cardsTouched;
  totalFields += fieldsTouched;
  console.log(`${path.relative(root, deckPath)}: ${cardsTouched} cards, ${fieldsTouched} field arrays`);
}

console.log(`total: ${totalCards} cards, ${totalFields} field arrays`);
