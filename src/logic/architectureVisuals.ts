import type { Card } from '../types';

export interface ArchitectureVisual {
  title: string;
  titleEn: string;
  diagram: string;
  bullets: string[];
  codeLabel?: string;
  codeSample?: string;
}

interface ComponentDef {
  id: string;
  label: string;
  aliases: string[];
  role: string;
  roleEn: string;
  layer: 'edge' | 'service' | 'async' | 'data' | 'ml' | 'ops';
}

const COMPONENTS: ComponentDef[] = [
  {
    id: 'dns',
    label: 'DNS',
    aliases: ['dns', 'domain name'],
    role: '先把域名解析到入口地址，属于进入系统前的寻址层。',
    roleEn: 'Resolves the domain name before traffic reaches the system.',
    layer: 'edge',
  },
  {
    id: 'cdn',
    label: 'CDN',
    aliases: ['cdn', 'edge cache', 'static asset', 'static content'],
    role: '把静态内容、图片、视频片段放到离用户更近的边缘节点，降低延迟和源站压力。',
    roleEn: 'Serves static content from edge locations to reduce latency and origin load.',
    layer: 'edge',
  },
  {
    id: 'lb',
    label: 'Load Balancer',
    aliases: ['load balancer', 'load-balancer', 'lb ', 'alb', 'nlb'],
    role: '把入口流量分散到多个服务实例，提供横向扩展和故障摘除。',
    roleEn: 'Distributes incoming traffic across service instances for scale and failover.',
    layer: 'edge',
  },
  {
    id: 'api_gateway',
    label: 'API Gateway',
    aliases: ['api gateway', 'gateway', 'api layer', 'edge service'],
    role: '统一做路由、认证、限流、协议转换，避免每个后端服务重复处理入口逻辑。',
    roleEn: 'Centralizes routing, auth, rate limiting, and protocol translation.',
    layer: 'edge',
  },
  {
    id: 'rate_limiter',
    label: 'Rate Limiter',
    aliases: ['rate limiter', 'rate-limiter', 'throttle', 'token bucket', 'leaky bucket'],
    role: '保护下游服务，把突发请求转成可控吞吐，常放在网关或服务入口。',
    roleEn: 'Protects downstream services by smoothing bursts at the gateway or service edge.',
    layer: 'service',
  },
  {
    id: 'service',
    label: 'Application Service',
    aliases: ['service', 'app server', 'application server', 'backend', 'microservice', 'web server'],
    role: '承载业务逻辑，把请求拆成缓存、数据库、队列、搜索等具体依赖。',
    roleEn: 'Owns business logic and coordinates cache, database, queue, search, and other dependencies.',
    layer: 'service',
  },
  {
    id: 'auth',
    label: 'Auth Service',
    aliases: ['auth', 'authentication', 'authorization', 'oauth', 'jwt', 'session'],
    role: '验证身份和权限，通常在网关或核心服务前后被调用。',
    roleEn: 'Validates identity and permissions around the gateway or application service.',
    layer: 'service',
  },
  {
    id: 'cache',
    label: 'Cache / Redis',
    aliases: ['cache', 'redis', 'memcached', 'ttl', 'cache-aside'],
    role: '缓存热点读、会话或派生结果，用内存和 TTL 换低延迟；代价是失效和一致性。',
    roleEn: 'Caches hot reads, sessions, or derived results with TTLs; the tradeoff is invalidation and consistency.',
    layer: 'data',
  },
  {
    id: 'queue',
    label: 'Queue',
    aliases: ['queue', 'sqs', 'rabbitmq', 'pub/sub', 'pubsub', 'message broker', 'job queue'],
    role: '把慢任务、重试、削峰从同步请求里拆出去；消费者要能幂等处理。',
    roleEn: 'Decouples slow work, retries, and burst absorption from synchronous requests.',
    layer: 'async',
  },
  {
    id: 'kafka',
    label: 'Kafka / Stream',
    aliases: ['kafka', 'event stream', 'streaming', 'log stream'],
    role: '作为可回放的事件日志，适合多消费者、实时计算和数据管道。',
    roleEn: 'Acts as a replayable event log for multiple consumers, realtime processing, and data pipelines.',
    layer: 'async',
  },
  {
    id: 'worker',
    label: 'Worker',
    aliases: ['worker', 'consumer', 'background job', 'async job', 'scheduler'],
    role: '异步执行转码、通知、聚合、爬取、补偿等不适合阻塞用户请求的任务。',
    roleEn: 'Runs asynchronous work such as transcoding, notifications, aggregation, crawling, or compensation.',
    layer: 'async',
  },
  {
    id: 'db',
    label: 'Primary DB',
    aliases: ['postgres', 'postgresql', 'mysql', 'relational', 'rdbms', 'sql database', 'primary db', 'database'],
    role: '保存强一致核心状态；适合事务、约束、关系查询，但写扩展通常更贵。',
    roleEn: 'Stores strongly consistent core state with transactions and constraints; write scaling is costlier.',
    layer: 'data',
  },
  {
    id: 'nosql',
    label: 'NoSQL Store',
    aliases: ['dynamodb', 'cassandra', 'mongodb', 'wide-column', 'wide column', 'document store', 'nosql'],
    role: '按访问模式做高吞吐读写和水平扩展；代价是查询灵活性、事务或 join 能力受限。',
    roleEn: 'Scales high-throughput reads/writes around access patterns, trading off joins, flexible queries, or transactions.',
    layer: 'data',
  },
  {
    id: 'object_store',
    label: 'Object Storage',
    aliases: ['s3', 'object storage', 'blob storage', 'gcs', 'image storage', 'video storage'],
    role: '存大文件、图片、视频和备份；元数据通常放数据库，内容走 CDN。',
    roleEn: 'Stores large blobs such as images, videos, and backups; metadata usually stays in a database.',
    layer: 'data',
  },
  {
    id: 'search',
    label: 'Search Index',
    aliases: ['elasticsearch', 'opensearch', 'search index', 'inverted index', 'full text search'],
    role: '服务全文检索、排序和过滤；通常由异步管道从主库同步，不能当权威数据源。',
    roleEn: 'Serves full-text search, ranking, and filtering; it is usually a derived index, not the source of truth.',
    layer: 'data',
  },
  {
    id: 'coordination',
    label: 'Coordination',
    aliases: ['zookeeper', 'etcd', 'lock', 'leader election', 'distributed lock', 'coordination'],
    role: '处理 leader election、配置、锁或成员发现；要小心把它变成全局瓶颈。',
    roleEn: 'Handles leader election, configuration, locks, or membership; avoid turning it into a global bottleneck.',
    layer: 'ops',
  },
  {
    id: 'metrics',
    label: 'Metrics / Logs',
    aliases: ['metrics', 'monitoring', 'observability', 'logs', 'tracing', 'alerting'],
    role: '把延迟、错误率、吞吐和业务指标暴露出来，用来定位瓶颈和回归。',
    roleEn: 'Exposes latency, errors, throughput, and business metrics for debugging and regression detection.',
    layer: 'ops',
  },
  {
    id: 'vector_db',
    label: 'Vector DB',
    aliases: ['vector db', 'vector database', 'embedding store', 'ann index', 'nearest neighbor', 'similarity search'],
    role: '用向量相似度找候选内容，适合推荐、语义检索和 RAG 的召回阶段。',
    roleEn: 'Retrieves candidates by vector similarity for recommendations, semantic search, and RAG.',
    layer: 'ml',
  },
  {
    id: 'feature_store',
    label: 'Feature Store',
    aliases: ['feature store', 'features', 'feature engineering'],
    role: '统一训练和线上推理特征，减少 training-serving skew。',
    roleEn: 'Shares features between training and serving to reduce training-serving skew.',
    layer: 'ml',
  },
  {
    id: 'model',
    label: 'Model Service',
    aliases: ['model service', 'inference', 'llm', 'model', 'ranking model', 'classifier', 'reranker'],
    role: '做预测、排序、分类或生成；需要关注延迟、成本、批处理和降级。',
    roleEn: 'Runs prediction, ranking, classification, or generation with latency, cost, batching, and fallback tradeoffs.',
    layer: 'ml',
  },
];

const DIRECTED_ALIASES = new Set(['service', 'backend', 'database', 'features']);

/**
 * Component detection reads ONLY the parts of the card that describe an actual
 * topology: scenario, stem, cloze text, chain steps. Options/why/tags name
 * CANDIDATES under comparison ("NoSQL vs relational") — feeding them in used
 * to draw mutually-exclusive choices as co-existing boxes in one diagram.
 */
function textFor(card: Card) {
  return [card.scenario, card.q, card.text, ...(card.steps ?? [])]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

/**
 * A sketch is only warranted when the card is ABOUT structure / access order /
 * data flow (用户判据). Selection cards (fit/contrast) whose scenario merely
 * lists requirements get a comparison table instead, not a diagram.
 */
const DATA_FLOW_RE =
  /(in front of|behind|sends? .{0,30}(to|into)|fan-?out|fan-?in|pipeline|write[- ]?(through|back|behind)|read[- ]?through|cache[- ]aside|→|->|写入|读取|读写路径|推送|拉取|经过|流经|流向|前面|背后|挡在|削峰|异步.{0,6}(处理|消费)|消费|回源|穿透|旁路|上传|下发|路由到|转发|同步到|复制到|扇出|先写|再写|先读)/i;

function flowIsTheSubject(card: Card): boolean {
  const structuralText = [card.scenario, card.q].filter(Boolean).join('\n');
  return DATA_FLOW_RE.test(structuralText);
}

function hasAlias(text: string, alias: string) {
  const normalized = alias.trim().toLowerCase();
  if (DIRECTED_ALIASES.has(normalized)) return text.includes(normalized);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(text);
}

function detectComponents(card: Card): ComponentDef[] {
  const text = textFor(card);
  const found = COMPONENTS.filter((component) => component.aliases.some((alias) => hasAlias(text, alias)));
  const byId = new Map(found.map((component) => [component.id, component]));

  const looksLikeSystemDesign =
    card.topic === 'system-design' ||
    card.topic === 'llm-sd' ||
    card.topic === 'low-level-design' ||
    card.tags?.some((tag) => tag === 'track:classic-sd' || tag === 'track:llm-sd' || tag === 'track:low-level-design');

  if (looksLikeSystemDesign && found.length > 0) {
    if (!byId.has('service')) byId.set('service', COMPONENTS.find((c) => c.id === 'service')!);
    if (!byId.has('lb') && (byId.has('api_gateway') || byId.has('rate_limiter'))) {
      byId.set('lb', COMPONENTS.find((c) => c.id === 'lb')!);
    }
    if (!byId.has('worker') && (byId.has('queue') || byId.has('kafka'))) {
      byId.set('worker', COMPONENTS.find((c) => c.id === 'worker')!);
    }
  }

  return COMPONENTS.filter((component) => byId.has(component.id));
}

function node(id: string, label: string) {
  return `${id}["${label.replace(/"/g, "'")}"]`;
}

function uniqueLines(lines: string[]) {
  return [...new Set(lines)];
}

function buildDiagram(components: ComponentDef[]) {
  const has = (id: string) => components.some((component) => component.id === id);
  const seen = new Set<string>();
  const lines = ['flowchart LR'];
  const ref = (id: string, label: string) => {
    if (seen.has(id)) return id;
    seen.add(id);
    return node(id, label);
  };
  const addEdge = (fromId: string, fromLabel: string, toId: string, toLabel: string) => {
    lines.push(`  ${ref(fromId, fromLabel)} --> ${ref(toId, toLabel)}`);
  };

  let ingressId = 'user';
  let ingressLabel = 'User / Client';
  const advanceIngress = (nextId: string, nextLabel: string) => {
    addEdge(ingressId, ingressLabel, nextId, nextLabel);
    ingressId = nextId;
    ingressLabel = nextLabel;
  };

  if (has('dns')) advanceIngress('dns', 'DNS');
  if (has('cdn')) advanceIngress('cdn', 'CDN / Edge Cache');
  if (has('lb')) advanceIngress('lb', 'Load Balancer');
  if (has('api_gateway')) advanceIngress('gateway', 'API Gateway');
  if (has('rate_limiter')) advanceIngress('limiter', 'Rate Limiter');
  advanceIngress('svc', 'Application Service');

  if (has('auth')) addEdge('svc', 'Application Service', 'auth', 'Auth Service');
  if (has('cache')) addEdge('svc', 'Application Service', 'cache', 'Cache / Redis');
  if (has('db')) {
    if (has('cache')) addEdge('cache', 'Cache / Redis', 'db', 'Primary DB');
    else addEdge('svc', 'Application Service', 'db', 'Primary DB');
  }
  if (has('nosql')) addEdge('svc', 'Application Service', 'nosql', 'NoSQL Store');
  if (has('object_store')) addEdge('svc', 'Application Service', 'blob', 'Object Storage');
  if (has('search')) addEdge('svc', 'Application Service', 'search', 'Search Index');
  if (has('queue')) addEdge('svc', 'Application Service', 'queue', 'Queue');
  if (has('kafka')) addEdge('svc', 'Application Service', 'stream', 'Kafka / Event Stream');
  if (has('worker')) {
    if (has('queue')) addEdge('queue', 'Queue', 'worker', 'Worker');
    if (has('kafka')) addEdge('stream', 'Kafka / Event Stream', 'worker', 'Worker');
    if (!has('queue') && !has('kafka')) addEdge('svc', 'Application Service', 'worker', 'Worker');
  }
  if (has('search') && has('worker')) addEdge('worker', 'Worker', 'search', 'Search Index');
  if (has('db') && has('worker')) addEdge('worker', 'Worker', 'db', 'Primary DB');
  if (has('object_store') && has('worker')) addEdge('worker', 'Worker', 'blob', 'Object Storage');
  if (has('vector_db')) addEdge('svc', 'Application Service', 'vector', 'Vector DB');
  if (has('feature_store')) addEdge('svc', 'Application Service', 'feature', 'Feature Store');
  if (has('model')) {
    if (has('feature_store')) addEdge('feature', 'Feature Store', 'model', 'Model Service');
    else if (has('vector_db')) addEdge('vector', 'Vector DB', 'model', 'Model Service');
    else addEdge('svc', 'Application Service', 'model', 'Model Service');
  }
  if (has('coordination')) addEdge('svc', 'Application Service', 'coord', 'Coordination');
  if (has('metrics')) {
    addEdge('svc', 'Application Service', 'obs', 'Metrics / Logs');
    if (has('worker')) addEdge('worker', 'Worker', 'obs', 'Metrics / Logs');
  }

  return uniqueLines(
    lines
      .filter(Boolean)
      .map((line, index) => (index === 0 ? line.trim() : `  ${line.trim()}`.trimEnd())),
  ).join('\n');
}

function buildBullets(components: ComponentDef[]) {
  const byLayer = new Map<ComponentDef['layer'], ComponentDef[]>();
  for (const component of components) {
    const group = byLayer.get(component.layer) ?? [];
    group.push(component);
    byLayer.set(component.layer, group);
  }

  const bullets: string[] = [];
  const edge = byLayer.get('edge') ?? [];
  const service = byLayer.get('service') ?? [];
  const async = byLayer.get('async') ?? [];
  const data = byLayer.get('data') ?? [];
  const ml = byLayer.get('ml') ?? [];
  const ops = byLayer.get('ops') ?? [];

  if (edge.length) bullets.push(`入口层：${edge.map((c) => c.label).join(' → ')} 负责把流量安全、稳定地送进系统。`);
  if (service.length) bullets.push(`服务层：${service.map((c) => c.label).join('、')} 承载业务判断；优点是集中控制，缺点是容易成为热点。`);
  if (data.length) bullets.push(`数据层：${data.map((c) => c.label).join('、')} 决定一致性、查询能力和扩展方式，不同存储不要混成一个职责。`);
  if (async.length) bullets.push(`异步层：${async.map((c) => c.label).join('、')} 用来削峰、重试和解耦，但要设计幂等和补偿。`);
  if (ml.length) bullets.push(`智能层：${ml.map((c) => c.label).join('、')} 通常分召回、特征、推理/排序，重点看延迟和降级策略。`);
  if (ops.length) bullets.push(`运维层：${ops.map((c) => c.label).join('、')} 不直接服务用户请求，但决定系统能不能被观察和恢复。`);

  return bullets.slice(0, 4);
}

function codeFor(components: ComponentDef[]): Pick<ArchitectureVisual, 'codeLabel' | 'codeSample'> {
  const has = (id: string) => components.some((component) => component.id === id);

  if (has('rate_limiter')) {
    return {
      codeLabel: '模式伪代码 · token bucket',
      codeSample: `allowed(user):
  bucket = load_bucket(user)
  bucket.tokens += elapsed * refill_rate
  bucket.tokens = min(bucket.tokens, capacity)
  if bucket.tokens < request_cost:
    return reject_429()
  bucket.tokens -= request_cost
  save_bucket(user, bucket)
  return pass_to_service()`,
    };
  }

  if (has('cache')) {
    return {
      codeLabel: '模式伪代码 · cache-aside',
      codeSample: `read(key):
  value = cache.get(key)
  if value != null:
    return value
  value = database.read(key)
  cache.set(key, value, ttl)
  return value

write(key, value):
  database.write(key, value)
  cache.delete(key)  # or update with version`,
    };
  }

  if (has('queue') || has('kafka') || has('worker')) {
    return {
      codeLabel: '模式伪代码 · idempotent worker',
      codeSample: `handle(event):
  if processed(event.id):
    return ack()
  begin_transaction()
  apply_business_change(event)
  mark_processed(event.id)
  commit()
  ack()`,
    };
  }

  if (has('vector_db') || has('model')) {
    return {
      codeLabel: '模式伪代码 · retrieval + ranking',
      codeSample: `answer(request):
  query_vec = embed(request.text)
  candidates = vector_db.search(query_vec, top_k=100)
  features = feature_store.load(candidates, request.user)
  ranked = model.rank(candidates, features)
  return ranked.take(10)`,
    };
  }

  if (has('nosql')) {
    return {
      codeLabel: '模式伪代码 · access-pattern first',
      codeSample: `table design:
  partition_key = entity_or_tenant_id
  sort_key = time_or_rank

query:
  read exactly one partition
  avoid cross-partition joins
  duplicate derived views when needed`,
    };
  }

  return {};
}

export function buildArchitectureVisual(card: Card): ArchitectureVisual | null {
  const eligible =
    card.topic === 'system-design' ||
    card.topic === 'llm-sd' ||
    card.topic === 'low-level-design' ||
    card.tags?.some((tag) => tag === 'track:classic-sd' || tag === 'track:llm-sd' || tag === 'track:low-level-design');
  if (!eligible) return null;

  // Magnitude anchors never need a topology sketch.
  if (card.atomType === 'number') return null;

  // Selection cards get a diagram only when the scenario actually describes a
  // flow/topology ("Redis in front of Postgres"); a requirements list ("schema
  // changes often, needs horizontal scaling → NoSQL") is a comparison, and its
  // visual is the §1.7 table — drawing both candidates as one architecture
  // was nonsense.
  if ((card.atomType === 'fit' || card.atomType === 'contrast') && !flowIsTheSubject(card)) {
    return null;
  }

  const components = detectComponents(card);
  if (components.length < 2) return null;

  const named = components.filter((component) => component.id !== 'service');
  const subject = named.length ? named.slice(0, 3).map((component) => component.label).join(' + ') : 'system components';
  const code = codeFor(components);

  return {
    title: `自动架构草图：${subject}`,
    titleEn: `Auto architecture sketch: ${subject}`,
    diagram: buildDiagram(components),
    bullets: buildBullets(components),
    ...code,
  };
}
