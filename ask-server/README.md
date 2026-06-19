# atoms-ask

一个问答服务，两个客户端：**Even G2 眼镜**（喊「Hey Even」）和 **Atoms App**（刷卡时点「问 AI」）。

答案来自**你自己的学习资料**——不是通用搜索。

## 里面有什么

| 来源 | 数量 | 内容 |
|---|---|---|
| SDH 检索库 | 3,897 片段 / 358 篇 | Hello Interview、hack2hire SD+OOD、educative |
| Atoms 卡片 | 336 张 | 问题 / 念稿 / 中文讲法 / 要点 / 为什么 |
| 术语表 | 54 个中英对照 | 让中文提问能找到英文笔记 |

合计 8.4MB，**打进容器**，不做实时同步——静态文件不会漂移、不会半失败、不花钱。
内容更新 = 重新跑一次部署。

## 接口

| 路径 | 谁用 | 格式 |
|---|---|---|
| `POST /v1/chat/completions` | 眼镜 | OpenAI 格式（眼镜只认这个），支持流式 |
| `POST /ask` | Atoms App | `{"question":"..."}` → `{"answer":"...","sources":[...]}` |
| `GET /health` | 你 | 存活 + 语料条数 |

两条都要 `Authorization: Bearer <ASK_TOKEN>`。

## 本地跑

```bash
node build-corpus.mjs && node build-glossary.mjs
ANTHROPIC_API_KEY=sk-ant-... node server.mjs
curl -s localhost:8080/health
```

## 部署

```bash
GCP_PROJECT_ID=ivory-vim-503007-j0 ./deploy.sh setup     # 只做一次，会告诉你怎么存密钥
GCP_PROJECT_ID=ivory-vim-503007-j0 ASK_TOKEN=<长随机串> ./deploy.sh
```

部署完会打印眼镜里该填的 Endpoint 和 API Key。

## 两个设计决定

**检索用 BM25 不用向量。** 语料是你自己的材料、用你自己的词汇提问。BM25 在内存里几毫秒出结果，
不需要 embedding 服务、不需要多一个密钥、不会静默失败。SDH 从七月起就是这么干的。

**中文提问要翻译成英文再检索。** 实测发现的坑：笔记是英文写的，你习惯中文提问，
字面匹配对不上——「什么是一致性哈希」原本一条笔记都找不到，英文问却秒中。
解法是用你自己那份口条术语表做查询扩展，零成本。

另外两个实测调整：中文**单字不做检索词**（跟英文字母一样常见，会让「什么/是一」这种
脚手架词堆满分数），以及**结果保证同时有笔记和卡片**（笔记讲「是什么」，你的卡片讲
「怎么说」，纯按分数排会塌成一种）。

## 成本

每次提问约 **1.3 美分**（约 5,700 输入 + 200 输出 token，sonnet-5）。
Cloud Run 闲时缩到零不计费；很久没用后第一个问题会慢几秒（冷启动）。
嫌慢可以加 `--min-instances=1`，代价是每月几美元。
