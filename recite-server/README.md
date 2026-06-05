# atoms-recite

念稿练习的后端（M4 §3）。Atoms 里**唯一联网才能用的功能**：录音、转写、判官三样天然在云上。

和 `sync-server/` 同一技术栈：Node 20、裸 `node:http`、ESM、无框架、bearer token 来自
`ATOM_SYNC_TOKEN`、CORS `*`。日期全走 America/Los_Angeles（和 jobscan 的 `la_today` 一致）。

```
server.mjs        HTTP 层        ← web.py 的 /recite 路由
lib/recite.mjs    确定性核心      ← recite.py（逐函数同名，常数一个不改）
lib/judge.mjs     LLM 判官        ← ai.py::review_take（system prompt 逐字节相同）
lib/stt.mjs       Speech-to-Text v2（chirp_2 → long 兜底）  ← 替换 Parakeet 子进程
lib/metrics.mjs   停顿/语速指标（用词时间戳算）             ← 替换 ffmpeg silencedetect
lib/store.mjs     Firestore / 本地 JSON 两种实现
lib/media.mjs     GCS / 本地目录两种实现
data/             recite.bundle.json + recite.numbers.json（生成物，不进 git）
```

## 本地跑

```bash
npm install
./sync-content.sh                 # src/content/ → data/（部署前也要跑）
npm test                          # node --test

ATOM_SYNC_TOKEN=dev \
RECITE_STORE=file RECITE_STORE_DIR=/tmp/recite-store \
RECITE_MEDIA_DIR=/tmp/recite-media \
ANTHROPIC_API_KEY=sk-... GCP_PROJECT=<project> \
node server.mjs
# → Atoms recite listening on 8080 · 336 items

curl -s -H 'authorization: Bearer dev' localhost:8080/recite/overview | head -c 200
```

原声/对话音频在本地模式下要放到 `$RECITE_MEDIA_DIR/orig/<item_id>.mp3`、`dialog/<item_id>.mp3`
（可以直接软链 jobscan 的 `data/recite/`）。没放也不影响练习，只是 `/media/orig/...` 返回 404。

转写和判官都要真凭据。想在没有凭据的机器上把流程走通，加 `RECITE_STUB_STT=1
RECITE_STUB_JUDGE=1` —— 这两个桩**必须显式打开**，生产路径永远走不到它们。

## 环境变量

| 变量 | 必需 | 说明 |
|---|---|---|
| `ATOM_SYNC_TOKEN` | ✅ | 和 atoms-sync 同一个口令。`/health` 之外全要；`/media/*` 用 `?token=` |
| `ANTHROPIC_API_KEY` | ✅（评分） | Secret Manager 挂载。缺了只是评分返回空卡，录音照存 |
| `GCP_PROJECT` | ✅（转写） | Speech-to-Text v2 的 recognizer 路径用它（Cloud Run 上也可用 `GOOGLE_CLOUD_PROJECT`）|
| `RECITE_BUCKET` | ✅（云上） | 私有桶名，如 `atoms-recite-media-$GCP_PROJECT_ID`。设了 `RECITE_MEDIA_DIR` 时忽略 |
| `STT_MODEL` | | 默认 `chirp_2`。出错自动退一次 `long` |
| `STT_LOCATION` | | 默认 `us-central1`。客户端会连 `<location>-speech.googleapis.com` |
| `PUBLIC_BASE_URL` | | `audio_url` 的前缀；不设就从请求的 `Host` / `X-Forwarded-Proto` 推 |
| `RECITE_STORE` | | `firestore`（默认）\| `file` |
| `RECITE_STORE_DIR` | | `file` 模式的 JSON 目录（设了它且没设 `RECITE_STORE` 就默认走 file）|
| `RECITE_MEDIA_DIR` | | 设了就用本地目录代替 GCS（`orig/ dialog/ takes/`）|
| `RECITE_DATA_DIR` | | bundle 的位置，默认 `./data` |
| `RECITE_JUDGE_MODEL` / `RECITE_JUDGE_EFFORT` | | 默认 `claude-opus-4-8` / `high` |
| `RECITE_STUB_STT` / `RECITE_STUB_JUDGE` | | `=1` 打桩。只给测试和本地演练用 |
| `PORT` | | Cloud Run 自动注入 |

## 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/healthz` | 免鉴权 |
| GET | `/recite/overview` | 全库状态 + 今日队列 + 直方图 + 撞车组 |
| GET | `/recite/items/:id` | 状态 + 这一遍的变体 + 最近 10 条 take |
| POST | `/recite/items/:id/take` | body = 音频原始字节（≤30 MB），`Content-Type: audio/webm\|mp4\|m4a\|x-m4a`，元数据在 `X-Recite-Meta: base64(JSON)` |
| POST | `/recite/takes/:id/rescore` | `{why_line?, mode?}` → STT → 指标 → 判官 → 门 → 箱 |
| POST | `/recite/items/:id/mark` | `{action: needs_rewrite\|archive\|unarchive\|scope_thin\|box\|snooze, box?, days?}` |
| POST | `/recite/items/:id/exposure` | `{stage}` |
| GET | `/media/orig/:id.mp3` `/media/dialog/:id.mp3` `/media/take/:take_id` | `?token=`，支持 `Range`（206 + `Content-Range`）|

评分是**可选**的：上传只落盘（`{saved:true, scored:false}`），`rescore` 才花钱。
录音先写存储、再插 take 行、再做别的 —— STT 或 Anthropic 任一失败都返回 `{judge_error}` 且
录音还在，卡片可以老实说「评分没跑出来，录音已存 [重试评分]」。

## 部署（M4 §6）

```bash
gcloud services enable speech.googleapis.com secretmanager.googleapis.com storage.googleapis.com

# 桶 + 原声（幂等）
GCP_PROJECT_ID=<project> ../scripts/recite/upload_media.sh

# 判官的 key
gcloud secrets create anthropic-api-key --data-file=- <<< "$ANTHROPIC_API_KEY"

./sync-content.sh          # data/ 必须在，Dockerfile 会 COPY 它
gcloud run deploy atoms-recite --source=. --region=us-central1 \
  --memory=1Gi --timeout=300 --concurrency=4 \
  --set-env-vars=ATOM_SYNC_TOKEN=<同 atoms-sync>,RECITE_BUCKET=atoms-recite-media-<project>,STT_MODEL=chirp_2,STT_LOCATION=us-central1,GCP_PROJECT=<project> \
  --set-secrets=ANTHROPIC_API_KEY=anthropic-api-key:latest
```

默认 compute SA 需要 `roles/datastore.user`、桶的 `roles/storage.objectAdmin`、
`roles/secretmanager.secretAccessor`、`roles/speech.client`。

前端：`EXPO_PUBLIC_ATOM_RECITE_URL=<url>`，口令复用 `atoms.sync.token`。

## 移植纪律

`lib/recite.mjs` 是 `app/recite.py` 的逐函数移植，文件头抄着那三条被数据推翻过的设计约束
（wpm 不进硬门 / 她看见的 == 她被评的 / 压缩档 fail 不降箱）。改这里之前先读它们，
`node --test` 里每一条都有对应断言。刻意的偏差一律写 `// DEVIATION:` 注明理由。
