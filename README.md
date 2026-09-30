# Atoms

Atoms turns system design topics into review cards, design exercises, and spoken prompts. The Expo app stores progress locally using SQLite and schedules reviews with FSRS.

## Try it

```sh
npm ci
npm run web
```

Open the local address Expo prints. On the Today screen, tap ✍️ (白纸), then open **Demo Export**. Write the request and the two possible responses, then reveal the checklist and compare your answer. The spoken practice library has a sample about the same API.

## How it works

| Layer | Responsibility |
| --- | --- |
| Card pipeline | JSON source decks compile into a runtime bundle with stable IDs, topic tags, and ordered roadmap stages. |
| Review | FSRS determines what is due. Local SQLite keeps review state and settings across launches. |
| Design exercises | A scenario, checklist, and reference response give each output a concrete acceptance check. |
| Optional services | Separate Node servers provide sync, spoken practice, and retrieval. The local review loop runs without them. |

```sh
npm run build:deck
node scripts/validate-deck.mjs
npm run verify
```

The public deck ships with technical examples and a fictional spoken-practice prompt. To connect your own services, set the endpoints documented in `.env.example`.
