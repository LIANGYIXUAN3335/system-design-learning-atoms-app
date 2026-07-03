# Atoms — study app (M1 core loop + M2a)

> **速读** ｜ 「系统设计版百词斩」。M1：核心刷题循环（5 种题型 → 解释 + 🔊 → 忘了/模糊/记得 → `ts-fsrs` 排期）。M2a 新增：**学习路径**（track = tag 过滤器，626 张卡、可自建）、**规划器**（面试日期 → 每天新卡量）、**动机层**（每日目标环 + 🔥 连续天数 + 斩杀框架）、**节奏预设**（早晚/每天/隔天 → 提醒 + FSRS retention）、表格原子渲染。纯本地（expo-sqlite），无 AI、无 key、无网络依赖。设计决策见 `../atoms-m1-review.md` 与 `../atoms-m2a-review.md`。

Local-first Expo (React Native + TypeScript) app: `expo-sqlite` + `ts-fsrs` (the **only** scheduler), 626 bundled cards across tracks, per-card feedback capture with JSON export. No API key anywhere in the app.

## Run it（macOS + iPhone）

```bash
cd "…/system design learning/atoms-app"
npm install          # node_modules 已装好的话可跳过
npx expo start
```

1. iPhone 装 **Expo Go**（App Store，免费，无需开发者账号）。
2. 手机和 Mac 连**同一个 Wi-Fi**。
3. 用 iPhone **相机**扫终端里的二维码 → 在 Expo Go 里打开。
4. 扫码打不开（公司网络隔离等）→ 改跑 `npx expo start --tunnel`。
5. 电脑上快速看 demo：`npx expo start --web`（提醒通知在 web 上不可用，其余功能都在）。

> 注意：npm 全局缓存里有 root 属主文件（老 npm 的 bug），如果 `npm install` 报 `EACCES`，先跑一次 `sudo chown -R 501:20 ~/.npm`。
>
> 学习数据（FSRS 状态/反馈/日志/设置/自建路径）存在 Expo Go 沙盒内的 SQLite 里，按 `app.json` 的 `slug: "atoms"` 隔离——**slug 不要改**；删掉 Expo Go 会删掉学习记录。日常使用需要 Mac 开着 Metro（或用 Expo Go 的最近缓存）；等这变得烦人时，上 EAS Update（免费档）就能脱离 Mac 加载，见 M1 review §4.1。
>
> 本地提醒在 **Expo Go iOS** 可用（首次开启会请求通知权限）；实现是「未来 7 天的 DATE 触发器、每次启动重排」——超过 7 天不打开 app 提醒会断，打开即自愈。

## M2a features

- **学习路径（tracks）**：track = 保存下来的 tag 过滤器（并集语义 + 可选排除）。种子三条：AI coding (11) / 经典系统设计 (615) / LLM 系统设计 (0，等 M2c 生成填充)；`全部` 是内建兜底。设置页可随时新增/删除（例：名字"消息队列专项"，tags `kafka, queue`）。切换路径不动学习进度（FSRS 状态是 per-card 的）。
- **规划器**：可直接设置面试日期，或选准备时间 1-60 天自动生成日期；`newPerDay = max(ceil((路径卡数−已掌握)/(天数×0.8)), 1)`；100/天只是推荐节奏，短 deadline 可超过并提示冲刺压力。不设日期 = 默认 100/天。
- **动机层**：每日目标环（今日已答(去重)/目标）、🔥 连续天数（宽容口径：当天答过 ≥1 张就算）、斩杀文案（Session 头部实时"斩杀 N"、Done 页"本次斩杀 X · 今日 Y/Z · 🔥 N 天"+ 达成庆祝）。全部由 `review_log` 推导，无新表。
- **节奏预设**（设置页一个选择，绑两件事——提醒频率 + FSRS `request_retention`；**FSRS 仍是唯一调度器**）：早晚刷 0.95 / 每天刷 0.90（默认）/ 隔天刷 0.85。
- **表格原子**：ag/cr 卡自带的 `{headers, rows}` 表格在解释区原生渲染。

## What's inside

| Path | What |
|---|---|
| `App.tsx` | screen state machine: Today → Session → Done → Settings; deck/track/planner wiring |
| `src/content/deck.bundle.json` | **the runtime deck**（626 张，`build:deck` 生成，别手改） |
| `src/content/cards.json` + `ai-coding/` + `system-design/` | per-source decks（port/生成产物；bundle 的输入） |
| `src/content/tracks.json` | 种子路径（首启动种一次，之后归 DB 管，删了不会复活） |
| `src/config.ts` | tunables：`NEW_PER_DAY`、`RECOMMENDED_NEW_PER_DAY`、`MASTERED_STABILITY_DAYS`、learn-ahead、**RHYTHMS**（retention + 提醒模式） |
| `src/logic/` | pure logic：srs (含 `setRequestRetention`)、queue、planner、streak、tracks、settings、shuffle、grading、cloze、feedback |
| `src/db/database.ts` | SQLite v2：cards / srs / review_log / feedback / **settings / tracks** + 迁移 + 启动时内容↔状态调和 |
| `src/notifications.ts` | 提醒：未来 7 天 DATE 触发器批量重排；web no-op |
| `src/screens/`, `src/components/` | Today(路径选择器+目标环) / Session / Done(斩杀) / **Settings**；卡片渲染器 + Mermaid WebView + **TableView** |
| `scripts/port-cards.mjs` | 3 个 HTML 原型 → 规范化 deck JSON（`npm run port:cards`） |
| `scripts/build-deck.mjs` | 合并全部 deck + **按目录注入 `track:*` tag** → `deck.bundle.json`（`npm run build:deck`） |
| `scripts/validate-deck.mjs` | 校验任意 deck JSON（生成新内容后跑） |
| `scripts/selftest.ts` | 逻辑自检（bundle/tracks/planner/streak/rhythm 全覆盖）：`npm run selftest` |

`npm run verify` = typecheck + selftest + visual:validate（三道门都要绿）.

## Content workflow (M2a)

1. 手写卡的真源在 `../content/*.html`（M0 原型）；生成卡直接放 `src/content/<dir>/*.json`。
2. 改了 HTML 原型 → `npm run port:cards`（规范化 `en→why_en` 等 + 校验 + 打 tag）。
3. 新增/改动任何 deck 后 → `npm run build:deck` 重建 bundle（**track tag 在这里按目录注入**：`system-design/`→classic-sd、`ai-coding/`→ai-coding、`llm-sd/`→llm-sd；放进映射目录=自动入轨，或卡片自带 `track:*` tag）。
4. 重启 `npx expo start`。卡片内容**直接从 bundle 读取**（不再镜像进 SQLite——6k 张卡每次启动逐条写库是白付的数秒冷启动）；SQLite 只存可变状态（srs/review_log/feedback/settings/tracks），换 bundle 不影响学习进度。
5. 刷题里「导出反馈」→ JSON 喂给 Claude 生成补漏新卡（M2c 把这条链自动化成后台服务）。

## Key behaviors (决策日志：M1 review §6 · M2a review §5)

- **选项/链步骤每次渲染都重新洗牌**（种子卡 26/29 答案在 B；同卡当日重现时也换位）。
- 评分：忘了→Again，模糊→Hard，记得→Good；**答错或点过「不确定」时记得封顶 Hard**；cloze 纯自评不封顶。
- 队列：到期复习（Review 按自然日、Learning 按分钟 + 20min learn-ahead）**永远排在新卡前面、逾期最久优先**；新卡按当天日期稳定抽样、配额按当前路径独立计，且每次 session 只打乱**新卡段**的顺序（复习顺序是间隔重复的契约，不乱）；答错的卡当日会话内自动重现直到毕业；会话内回队限定在本次 session 的范围内——「只刷复习/只刷新卡」模式不会被范围外的到期卡灌爆。
- 规划器：面试日期未来 → `max(ceil((路径卡数−已掌握)/(天数×0.8)), 1)`，超过推荐节奏只警告不封顶；**面试当天或已过 → 新卡配额直接归零**（和"只清复习"的警告一致）。
- 目标环口径：`今日已答(去重) + 仍到期 + 剩余新卡配额`——单调，清空队列时恰好 100%。streak 全局、目标环按路径。
- 换节奏只改未来复习的间隔（retention 是调度参数，per-card 状态不动）。
