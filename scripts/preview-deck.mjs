#!/usr/bin/env node
/**
 * Generate a self-contained, flip-through HTML preview of a deck for QUALITY REVIEW.
 * Review mode: each card shows the answer + explanation immediately (no quizzing),
 * with a topic filter + prev/next, TTS on the English line, and Mermaid rendering.
 *
 * Usage:
 *   node scripts/preview-deck.mjs                         # previews src/content/deck.bundle.json
 *   node scripts/preview-deck.mjs src/content/system-design/core-concepts_caching.json
 *   node scripts/preview-deck.mjs <in.json> <out.html>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const inFile = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(root, 'src/content/deck.bundle.json');
const outFile = process.argv[3]
  ? path.resolve(process.cwd(), process.argv[3])
  : path.join(root, 'reports/deck-preview.html');

const raw = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards || [];

const ENGINE = [
'var DECK = __DECK__;',
'var byTopic = {}; DECK.forEach(function(c){var t=c.topic||"?";(byTopic[t]=byTopic[t]||[]).push(c);});',
'var topics = Object.keys(byTopic).sort();',
'var list = DECK.slice(); var idx = 0;',
'function esc(s){return String(s==null?"":s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});}',
'function speak(t){ if(!("speechSynthesis" in window)){alert("用 Chrome/Safari 打开可朗读");return;} try{speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(t);u.lang="en-US";u.rate=.95;speechSynthesis.speak(u);}catch(e){} }',
'function optsHtml(c){ if(!c.options||!c.answer) return ""; var mono=c.format==="code"; var h="<div class=opts>"; for(var k=0;k<c.options.length;k++){ var ok=c.answer.indexOf(k)>=0; var label=ok?"<b>\\u2713</b> ":("<span class=k>"+"ABCD"[k]+"</span> "); var txt=mono?("<code>"+esc(c.options[k])+"</code>"):esc(c.options[k]); h+="<div class=\\"opt"+(ok?" ok":"")+"\\">"+label+txt+"</div>"; } return h+"</div>"; }',
'function clozeHtml(c){ var f=function(t){return "<div class=cloze>"+esc(t).replace(/\\{\\{(.+?)\\}\\}/g,function(_,a){return "<b class=blank>"+esc(a)+"</b>";})+"</div>";}; return (c.text?f(c.text):"")+(c.text_en?f(c.text_en):""); }',
'function chainHtml(c){ if(!c.steps||!c.answerOrder) return ""; var h="<ol class=chain>"; for(var i=0;i<c.answerOrder.length;i++){h+="<li>"+esc(c.steps[c.answerOrder[i]])+"</li>";} return h+"</ol>"; }',
'function tableHtml(c){ if(!c.table) return ""; if(typeof c.table==="object"&&c.table.headers){ var t=c.table,h="<table class=cmp><thead><tr>"; t.headers.forEach(function(x){h+="<th>"+esc(x)+"</th>";}); h+="</tr></thead><tbody>"; (t.rows||[]).forEach(function(r){h+="<tr>";r.forEach(function(cell){h+="<td>"+esc(cell)+"</td>";});h+="</tr>";}); return h+"</tbody></table>"; } return "<pre class=mdtable>"+esc(c.table)+"</pre>"; }',
'function diagramHtml(c){ return c.diagram?("<div class=diawrap><div class=dialabel>\\u56fe\\u793a diagram</div><pre class=mermaid>"+c.diagram+"</pre></div>"):""; }',
'function tradeoffHtml(c){ return c.tradeoff?("<div class=tradeoff><b>取舍 tradeoff</b> "+esc(c.tradeoff)+"</div>"):""; }',
'function optionNotesHtml(c){ if(!c.options) return ""; var M=c.optionMeanings,D=c.optionDirectness,S=c.optionScenarioImpacts,Me=c.optionMeanings_en,De=c.optionDirectness_en,Se=c.optionScenarioImpacts_en,L=c.optionExplanations,Le=c.optionExplanations_en; var rich=(M&&M.length)||(D&&D.length)||(S&&S.length); if(!rich&&!(L&&L.length)) return ""; var join=function(a,b,d){return [a,b,d].filter(Boolean).join(" ");}; var h="<div class=onotes><div class=dialabel>选项解析 option notes</div>"; for(var k=0;k<c.options.length;k++){ var ok=c.answer&&c.answer.indexOf(k)>=0; var cn=rich?join(M&&M[k],D&&D[k],S&&S[k]):((L&&L[k])||""); var en=rich?join(Me&&Me[k],De&&De[k],Se&&Se[k]):((Le&&Le[k])||""); h+="<div class=\\"onote"+(ok?" ok":"")+"\\"><div class=oh>"+(ok?"<b>\\u2713</b> ":("<span class=k>"+"ABCD"[k]+"</span> "))+esc(c.options[k])+"</div>"; if(cn)h+="<div class=ol>"+esc(cn)+(en?" <span class=oen>"+esc(en)+"</span>":"")+"</div>"; h+="</div>"; } return h+"</div>"; }',
'function termsHtml(c){ if(!c.termDefinitions||!c.termDefinitions.length) return ""; var h="<div class=terms><div class=dialabel>术语 terms</div>"; c.termDefinitions.forEach(function(t){ var fn=t.fullName?(" ("+esc(t.fullName)+")"):""; h+="<div class=term><b>"+esc(t.term)+"</b>"+fn+" — "+esc(t.meaning||"")+(t.meaningEn?" <span class=oen>"+esc(t.meaningEn)+"</span>":"")+"</div>"; }); return h+"</div>"; }',
'function render(){ var c=list[idx]; document.getElementById("pos").textContent=(idx+1)+" / "+list.length; if(!c){document.getElementById("card").innerHTML="";return;}',
'  var tags="<div class=tags><span class=\\"tag t\\">"+esc(c.atomType||"")+"</span><span class=tag>"+esc(c.topic||"")+"</span><span class=tag>"+esc(c.sub||"")+"</span><span class=tag>"+esc(c.format)+"</span><span class=tag>"+esc(c.id)+"</span></div>";',
'  var scen=c.scenario?("<div class=scenario><b>Scenario \\u573a\\u666f</b>"+esc(c.scenario)+"</div>"):"";',
'  var q="<div class=q>"+esc(c.q||"")+"</div>";',
'  var body=optsHtml(c)+clozeHtml(c)+chainHtml(c);',
'  var en=c.why_en?("<div class=en><button class=spk onclick=\\"speak("+JSON.stringify(c.why_en).replace(/"/g,"&quot;")+")\\">\\ud83d\\udd0a</button><div>"+esc(c.why_en)+"</div></div>"):"";',
'  var other=c.whenOtherWins?("<div class=other><b>\\u4ec0\\u4e48\\u65f6\\u5019\\u9009\\u522b\\u7684\\uff1a</b> "+esc(c.whenOtherWins)+"</div>"):"";',
'  var code=c.codeSample?("<div class=code><div class=dialabel>\\u5b9e\\u73b0\\u53c2\\u8003"+(c.lang?(" \\u00b7 "+esc(c.lang)):"")+"</div><pre>"+esc(c.codeSample)+"</pre></div>"):"";',
'  var reveal="<div class=reveal><p class=why>"+esc(c.why||"")+"</p>"+tradeoffHtml(c)+optionNotesHtml(c)+tableHtml(c)+diagramHtml(c)+code+termsHtml(c)+en+other+"</div>";',
'  document.getElementById("card").innerHTML="<div class=inner>"+tags+scen+q+body+reveal+"</div>";',
'  var pre=document.querySelector("#card .mermaid"); if(pre&&window.mermaid){try{mermaid.run({nodes:[pre]});}catch(e){}}',
'  document.getElementById("card").scrollIntoView({block:"start"}); }',
'function go(d){ idx=Math.max(0,Math.min(list.length-1,idx+d)); render(); }',
'function setFilter(v){ list=(v==="all")?DECK.slice():DECK.filter(function(c){return (c.topic||"?")===v;}); idx=0; render(); }',
'(function(){ var sel=document.getElementById("filter"); var o0=document.createElement("option"); o0.value="all"; o0.textContent="\\u5168\\u90e8 ("+DECK.length+")"; sel.appendChild(o0); topics.forEach(function(t){var o=document.createElement("option");o.value=t;o.textContent=t+" ("+byTopic[t].length+")";sel.appendChild(o);}); sel.onchange=function(){setFilter(sel.value);}; })();',
'document.addEventListener("keydown",function(e){ if(e.key==="ArrowRight")go(1); if(e.key==="ArrowLeft")go(-1); if((e.key==="r"||e.key==="R")&&list[idx]&&list[idx].why_en)speak(list[idx].why_en); });',
'if(window.mermaid){mermaid.initialize({startOnLoad:false,theme:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"neutral"});}',
'render();',
].join('\n');

const HTML = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Atoms · Deck preview</title>
<style>
 :root{--bg:#faf9f7;--card:#fff;--ink:#1c1b19;--muted:#6b6a66;--line:#e6e4de;--accent:#534ab7;--ok:#1d9e75;--okbg:#e1f5ee;--chip:#f1efe8;--tealbg:#e1f5ee;--tealink:#0f6e56;--amberbg:#faeeda;--amberink:#854f0b;}
 @media(prefers-color-scheme:dark){:root{--bg:#1a1917;--card:#232220;--ink:#f2f0ea;--muted:#a3a19a;--line:#38362f;--accent:#afa9ec;--ok:#5dcaa5;--okbg:#0f3d31;--chip:#2c2b28;--tealbg:#0f3d31;--tealink:#9fe1cb;--amberbg:#3a2c12;--amberink:#f5c88a;}}
 *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;}
 .wrap{max-width:640px;margin:0 auto;padding:18px 16px 60px;}
 header{display:flex;justify-content:space-between;align-items:center;} h1{font-size:16px;margin:0;} .sub{color:var(--muted);font-size:13px;}
 .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0 16px;}
 select,button{font:inherit;font-size:14px;padding:8px 12px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);cursor:pointer;}
 .hint{color:var(--muted);font-size:12px;} .inner{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;}
 .tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;} .tag{font-size:11px;padding:3px 9px;border-radius:99px;background:var(--chip);color:var(--muted);} .tag.t{background:var(--tealbg);color:var(--tealink);}
 .scenario{background:var(--chip);border-radius:10px;padding:11px 13px;font-size:14px;margin-bottom:14px;} .scenario b{display:block;color:var(--muted);font-size:12px;margin-bottom:3px;text-transform:uppercase;letter-spacing:.04em;}
 .q{font-size:17px;font-weight:600;margin:0 0 14px;} .opts{display:flex;flex-direction:column;gap:8px;}
 .opt{border:1.5px solid var(--line);border-radius:11px;padding:11px 13px;} .opt.ok{border-color:var(--ok);background:var(--okbg);} .opt .k{color:var(--muted);font-weight:700;} .opt code{font-family:ui-monospace,Menlo,monospace;font-size:13px;}
 .cloze .blank{color:var(--ok);border-bottom:2px solid var(--ok);padding:0 3px;} .cloze{margin:4px 0;}
 ol.chain{margin:6px 0;padding-left:22px;} ol.chain li{margin:4px 0;}
 .reveal{margin-top:15px;border-top:1px dashed var(--line);padding-top:14px;} .why{font-size:15px;margin:0 0 12px;}
 table.cmp{width:100%;border-collapse:collapse;font-size:13.5px;margin:0 0 12px;} table.cmp th,table.cmp td{border:1px solid var(--line);padding:7px 9px;text-align:left;vertical-align:top;} table.cmp th{background:var(--chip);color:var(--muted);}
 .diawrap{background:var(--chip);border-radius:10px;padding:12px;margin:0 0 12px;overflow-x:auto;} .dialabel{font-size:12px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em;} .mermaid{text-align:center;}
 .en{background:var(--tealbg);color:var(--tealink);border-radius:10px;padding:11px 13px;font-size:14px;display:flex;gap:10px;align-items:flex-start;} .spk{flex:none;background:var(--tealink);color:var(--tealbg);border:none;border-radius:8px;padding:6px 11px;cursor:pointer;}
 .other{margin-top:11px;background:var(--amberbg);color:var(--amberink);border-radius:10px;padding:11px 13px;font-size:14px;}
 .code pre,.mdtable{background:#0e1116;color:#d7e0ee;border-radius:10px;padding:11px 13px;overflow-x:auto;font:12.5px/1.6 ui-monospace,Menlo,monospace;white-space:pre-wrap;} .code{margin-top:12px;}
 .tradeoff{background:var(--amberbg);color:var(--amberink);border-radius:10px;padding:9px 13px;font-size:13.5px;margin:0 0 12px;}
 .onotes{margin:0 0 12px;} .onote{border:1px solid var(--line);border-radius:10px;padding:9px 12px;margin-bottom:7px;} .onote.ok{border-color:var(--ok);background:var(--okbg);}
 .oh{font-weight:600;font-size:14px;margin-bottom:4px;} .oh .k{color:var(--muted);font-weight:700;}
 .ol{font-size:13px;margin:2px 0;} .ol b{color:var(--muted);font-weight:600;font-size:11px;margin-right:5px;} .oen{color:var(--muted);font-style:italic;}
 .terms{margin:0 0 12px;} .term{font-size:13px;margin:3px 0;padding:7px 10px;background:var(--chip);border-radius:8px;} .term b{color:var(--accent);}
 footer{text-align:center;color:var(--muted);font-size:12px;margin-top:20px;}
</style></head>
<body>
<div class="wrap">
 <header><h1>Atoms · Deck preview</h1><span class="sub" id="pos"></span></header>
 <div class="bar">
   <select id="filter"></select>
   <button onclick="go(-1)">‹ 上一张</button>
   <button onclick="go(1)">下一张 ›</button>
   <span class="hint">← → 翻页 · R 朗读</span>
 </div>
 <div id="card"></div>
 <footer>review 模式：直接显示正确答案 + 解释，用来审内容质量 · 图需联网渲染</footer>
</div>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>
${ENGINE.replace('__DECK__', JSON.stringify(cards))}
</script>
</body></html>`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, HTML);
console.log('wrote ' + outFile + '  (' + cards.length + ' cards)');
