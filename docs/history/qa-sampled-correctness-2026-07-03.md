# Sampled Correctness QA - 2026-07-03

## Scope

This pass reviewed a stratified, high-risk-weighted sample of 400 cards out of 6093 total cards, using six parallel review workers.

- Agent A: classic system-design problem breakdowns, 70 cards
- Agent B: classic core concepts, deep dives, and patterns, 70 cards
- Agent C: LLM system design / ML, 60 cards
- Agent D: low-level design, 60 cards
- Agent E: AI coding / algorithms, 70 cards
- Agent F: cross-track numbers, protocols, and visual-heavy cards, 70 cards

The user's prior manual deep read covered about 140 cards. This report treats the new 400-card sample as the statistical QA set; the total "human/agent touched" surface is about 540 cards, but not all with the same rubric.

## Result Summary

- Hard factual errors found in sample: 3 / 400 = 0.75%
- P0 clean rate in sample: 397 / 400 = 99.25%
- P1 caveat / overclaim findings: about 35 / 400 = 8.75%
- P2 clarity / precision findings: about 22 / 400 = 5.5%

Because the sample was deliberately biased toward risky cards (numbers, protocol claims, infrastructure internals, and generated visual-heavy content), the full-deck error rate may be lower, but this is not a proof. The right next step is another stratified sample after fixing deferred source-dependent items.

## P0 Fixes Applied

- `sd-problem-breakdowns-dropbox-003`: replaced outdated "max 50GB" Dropbox upload-limit claim with TB-scale wording. Official Dropbox help currently says the maximum upload size is 2 TB, with browser uploads above 375 GB potentially timing out.
- `sd-in-a-hurry-key-technologies-018`: corrected DynamoDB Standard storage from `$1.25/GB-month` to about `$0.25/GB-month`, and changed the comparison to object storage from an exact exaggerated ratio to order-of-magnitude guidance.
- `sd-deep-dives-elasticsearch-043`: fixed replica math. With X primary shards and Y replicas per primary, searchable copies are `X * (Y + 1)`, not `X * Y`.

## High-Confidence P1/P2 Fixes Applied

- Redis TTL lock cards now say Redis is fast coordination, while correctness-sensitive double assignment needs DB conditional writes, transactions, uniqueness, or fencing tokens.
- RabbitMQ TTL + DLX scheduling now includes head-of-line / expiry-precision caveats and alternatives such as delayed exchanges, SQS delay, Redis ZSET, or DB-backed scheduling.
- Live-comments latency card no longer treats 200ms as a universal human-perception hard boundary.
- Kafka expansion card no longer uses rigid broker throughput thresholds without benchmark context.
- Top-K traffic math corrected from "700k/s" to roughly "800k/s" where the card explicitly derives from 70B/day.
- W + R > N quorum card now includes same-replica-set, sloppy-quorum, concurrent-write, and version-resolution caveats.
- Cassandra cards now distinguish default/eventual usage from tunable consistency, and "no transactions" from "no general multi-row, multi-table ACID transactions."
- DynamoDB cards now avoid presenting closed-source internals as permanent API guarantees, and clarify DAX/Streams are cache/CDC tools, not cross-store strong-consistency mechanisms.
- Flink HA card now includes ZooKeeper, Kubernetes HA, or similar leader-election mechanisms.
- LLM moderation cards now separate model confidence from empirical precision, and treat report-rate loss as noisy weak supervision.
- Embedding cards now qualify 64-256 dimensions as a high-QPS coarse-retrieval starting range, not a universal rule.
- Low-level concurrency cards now mention spurious wakeups, lock/critical-section boundaries for dynamic config, and queue capacity caveats.
- Amazon Locker card now treats `Package` as a design-scope decision, not an always-wrong entity.
- Route-planner complexity card now states the assumption about line-aware edges and transfer-edge modeling.

## Deferred Follow-Ups

These should not be silently rewritten without either a source or a broader content pass:

- `aic-problem-breakdowns-card-game-016`: benchmark numbers likely depend on the exact deck/rules/search-space model. Needs source reconstruction before changing.
- `sd-problem-breakdowns-whatsapp-048`: Canva Redis Pub/Sub throughput / percentage claim needs source confirmation or should be generalized.
- `sd-problem-breakdowns-fb-live-comments-005`: "millions concurrent livestreams" may mean streams, viewers, or connections. Clarify intended unit.
- `sd-problem-breakdowns_top-k.json`: sweep remaining cards that still derive rate from 70B/day, not just the sampled card.
- DynamoDB internals cards: keep future edits tied to AWS docs / public paper wording, because product internals are not API guarantees.
- Large numeric capacity cards: continue sampling cards containing exact dollar amounts, latency thresholds, throughput limits, and "always/never/must" language.

## Verification

Commands run after fixes:

- `npm run build:deck`
- `node scripts/validate-deck.mjs src/content/cards.json src/content/system-design/*.json src/content/llm-sd/*.json src/content/low-level-design/*.json src/content/ai-coding/*.json`
- `npm run verify`
- `npm run visual:audit`

Results:

- Bundle rebuilt: 6093 cards
- All card schema checks passed
- Typecheck passed
- Selftests passed
- Mermaid visual validation passed: 978 checked, 0 parse errors
- Visual audit: 1300 / 6093 cards have explicit visuals, 21.3% total explicit visual coverage

## Official Sources Checked

- Dropbox upload limit: https://help.dropbox.com/sync/upload-limitations
- AWS DynamoDB pricing: https://aws.amazon.com/dynamodb/pricing/
- Elastic cluster shard/replica docs: https://www.elastic.co/docs/deploy-manage/distributed-architecture/clusters-nodes-shards

