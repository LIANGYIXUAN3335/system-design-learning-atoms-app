import type { Card } from '../types';

export interface TermDef {
  label: string;
  aliases: string[];
  englishName: string;
  meaning: string;
  meaningEn: string;
}

export interface TermHit extends TermDef {
  index: number;
  /** length of the matched alias — used for longest-match dedup (HTTP inside HTTP/2) */
  matchLength: number;
}

export interface ConceptVisual {
  id: string;
  title: string;
  titleEn: string;
  bullets: string[];
  bulletsEn: string[];
  diagram: string;
}

const TERMS: TermDef[] = [
  {
    label: 'TCP',
    aliases: ['TCP'],
    englishName: 'Transmission Control Protocol',
    meaning: '面向连接的传输协议，重点是可靠、有序。常用于 HTTP、数据库连接、文件传输。',
    meaningEn: 'A connection-oriented transport protocol that provides reliable, ordered delivery.',
  },
  {
    label: 'UDP',
    aliases: ['UDP'],
    englishName: 'User Datagram Protocol',
    meaning: '无连接传输协议，不保证送达和顺序，但延迟低。常用于实时音视频、游戏、DNS。',
    meaningEn: 'A connectionless transport protocol with low latency but no delivery or ordering guarantees.',
  },
  {
    label: 'HTTP',
    aliases: ['HTTP'],
    englishName: 'HyperText Transfer Protocol',
    meaning: '客户端和服务器之间的请求-响应协议。网页、REST API 大多都跑在它上面。',
    meaningEn: 'A request-response protocol used by browsers, websites, and many public APIs.',
  },
  {
    label: 'HTTPS',
    aliases: ['HTTPS'],
    englishName: 'HyperText Transfer Protocol Secure',
    meaning: '加了 TLS 加密和证书校验的 HTTP，用来保护传输内容和确认服务身份。',
    meaningEn: 'HTTP protected by TLS encryption and certificate validation.',
  },
  {
    label: 'TLS',
    aliases: ['TLS', 'SSL'],
    englishName: 'Transport Layer Security',
    meaning: '给网络连接加密、校验证书的安全层。HTTPS 里的 S 就主要靠它。',
    meaningEn: 'A security layer that encrypts connections and verifies certificates.',
  },
  {
    label: 'WebRTC',
    aliases: ['WebRTC'],
    englishName: 'Web Real-Time Communication',
    meaning: '浏览器或客户端之间做实时音视频、数据通道的技术，视频会议常用。',
    meaningEn: 'A browser/client technology for real-time peer-to-peer audio, video, and data channels.',
  },
  {
    label: 'WebSocket',
    aliases: ['WebSocket', 'WebSockets'],
    englishName: 'WebSocket protocol',
    meaning: '一条长期保持的双向连接，适合聊天、协作编辑、实时状态推送。',
    meaningEn: 'A persistent bidirectional connection for realtime messages between client and server.',
  },
  {
    label: 'Webhook',
    aliases: ['Webhook', 'webhook', 'webhooks', 'Webhooks', 'web hook', 'Web hook'],
    englishName: 'HTTP callback',
    meaning: '别人系统发生事件后，主动用 HTTP 调你的接口。常用于支付成功、构建完成、告警通知。',
    meaningEn: 'An HTTP callback where another system calls your endpoint after an event happens.',
  },
  {
    label: 'SSE',
    aliases: ['SSE', 'Server-Sent Events'],
    englishName: 'Server-Sent Events',
    meaning: '服务器持续推送到浏览器的单向事件流，适合通知、日志、进度更新。',
    meaningEn: 'A one-way event stream where the server continuously pushes updates to the browser.',
  },
  {
    label: 'gRPC',
    aliases: ['gRPC'],
    englishName: 'gRPC Remote Procedure Calls',
    meaning: '一种 RPC 框架，常配合 HTTP/2 和 protobuf，用在服务之间的高效调用。',
    meaningEn: 'A high-performance RPC framework often using HTTP/2 and Protocol Buffers for service calls.',
  },
  {
    label: 'Cassandra',
    aliases: ['Cassandra', 'Apache Cassandra'],
    englishName: 'Apache Cassandra',
    meaning: '分布式宽列数据库，masterless，擅长横向扩展的大规模写入和读写。',
    meaningEn: 'A masterless distributed wide-column database designed for horizontally scalable reads and writes.',
  },
  {
    label: 'LSM tree',
    aliases: ['LSM', 'LSM tree', 'Log-Structured Merge Tree'],
    englishName: 'Log-Structured Merge Tree',
    meaning: '写优化的数据结构：先写内存和日志，再批量刷成不可变文件，后台合并。',
    meaningEn: 'A write-optimized storage structure that batches writes into immutable sorted files and compacts them later.',
  },
  {
    label: 'Memtable',
    aliases: ['Memtable', 'memtable'],
    englishName: 'Memtable',
    meaning: 'LSM/Cassandra 写路径里的内存表，积累到阈值后刷盘成 SSTable。',
    meaningEn: 'An in-memory write buffer that later flushes to immutable SSTable files.',
  },
  {
    label: 'SSTable',
    aliases: ['SSTable', 'SSTables'],
    englishName: 'Sorted String Table',
    meaning: '不可变的有序磁盘文件，是 Cassandra/LSM 存储落盘后的主要形态。',
    meaningEn: 'An immutable sorted on-disk file used by Cassandra and LSM-based storage engines.',
  },
  {
    label: 'Commit Log',
    aliases: ['Commit Log', 'commit log', 'WAL', 'Write-Ahead Log'],
    englishName: 'Commit Log / Write-Ahead Log',
    meaning: '写入先追加到日志保证持久化；崩溃后可用它恢复尚未刷盘的数据。',
    meaningEn: 'An append-only durability log used to recover writes that have not been flushed to disk yet.',
  },
  {
    label: 'Quorum',
    aliases: ['Quorum', 'quorum'],
    englishName: 'Quorum',
    meaning: '多数派读写策略；读写都要拿到足够副本确认，用延迟换更强一致性。',
    meaningEn: 'A majority-based read/write policy that trades latency for stronger consistency.',
  },
  {
    label: 'Consistent Hashing',
    aliases: ['Consistent Hashing', 'consistent hashing', '一致性哈希'],
    englishName: 'Consistent Hashing',
    meaning: '把 key 和节点映射到哈希环，节点增减时只迁移相邻一小段数据。',
    meaningEn: 'A hashing strategy that maps keys and nodes onto a ring to minimize movement when nodes change.',
  },
  {
    label: 'HTTP/2',
    aliases: ['HTTP/2', 'HTTP2'],
    englishName: 'HyperText Transfer Protocol Version 2',
    meaning: 'HTTP 的新版传输方式，一条连接里可以并发多个请求，减少排队等待。',
    meaningEn: 'A newer HTTP transport that multiplexes many requests over one connection.',
  },
  {
    label: 'CDN',
    aliases: ['CDN'],
    englishName: 'Content Delivery Network',
    meaning: '分布在各地的缓存网络，把图片、视频、静态文件放得离用户更近。',
    meaningEn: 'A geographically distributed cache network that serves content closer to users.',
  },
  {
    label: 'DNS',
    aliases: ['DNS'],
    englishName: 'Domain Name System',
    meaning: '把域名解析成 IP 地址。可以理解成互联网里的地址查询系统。',
    meaningEn: 'The naming system that resolves domain names into IP addresses.',
  },
  {
    label: 'IP',
    aliases: ['IP address', 'IP'],
    englishName: 'Internet Protocol',
    meaning: '网络里的地址和寻址协议，让数据包知道要发到哪台机器或哪个网络。',
    meaningEn: 'The network-layer addressing protocol that routes packets to machines and networks.',
  },
  {
    label: 'API',
    aliases: ['API', 'APIs'],
    englishName: 'Application Programming Interface',
    meaning: '软件之间互相调用功能、交换数据的接口。',
    meaningEn: 'An interface that lets software components call functions or exchange data.',
  },
  {
    label: 'REST',
    aliases: ['REST', 'RESTful'],
    englishName: 'Representational State Transfer',
    meaning: '一种组织 HTTP API 的风格，通常围绕资源和 GET/POST/PUT/DELETE 方法设计。',
    meaningEn: 'An API style that models resources and uses HTTP methods to operate on them.',
  },
  {
    label: 'RPC',
    aliases: ['RPC'],
    englishName: 'Remote Procedure Call',
    meaning: '远程过程调用。像调用本地函数一样调用另一台机器上的服务。',
    meaningEn: 'A style where a client calls a remote service as if it were a local function.',
  },
  {
    label: 'NAT',
    aliases: ['NAT'],
    englishName: 'Network Address Translation',
    meaning: '把内网地址映射到公网地址的机制。家用路由器、公司网络里很常见。',
    meaningEn: 'A mechanism that maps private internal addresses to public network addresses.',
  },
  {
    label: 'STUN',
    aliases: ['STUN'],
    englishName: 'Session Traversal Utilities for NAT',
    meaning: '帮助客户端发现自己的公网地址，WebRTC 穿过 NAT 时常用。',
    meaningEn: 'A helper protocol that lets clients discover their public address behind NAT.',
  },
  {
    label: 'TURN',
    aliases: ['TURN'],
    englishName: 'Traversal Using Relays around NAT',
    meaning: 'WebRTC 直连失败时使用的中继服务器，代价更高但更稳。',
    meaningEn: 'A relay protocol used when direct WebRTC peer-to-peer connectivity fails.',
  },
  {
    label: 'ICE',
    aliases: ['ICE'],
    englishName: 'Interactive Connectivity Establishment',
    meaning: 'WebRTC 用来尝试多条连接路径，并选出可用路径的协商流程。',
    meaningEn: 'A WebRTC negotiation process that tests candidate paths and chooses a working connection.',
  },
  {
    label: 'JWT',
    aliases: ['JWT', 'JSON Web Token'],
    englishName: 'JSON Web Token',
    meaning: '自包含的签名令牌（header.payload.signature），服务端不用查库就能验证用户身份和过期时间。',
    meaningEn: 'A self-contained signed token whose payload carries identity and expiry, verifiable without a database lookup.',
  },
  {
    label: 'API key',
    aliases: ['API key', 'API-key', 'apikey'],
    englishName: 'API key',
    meaning: '发给调用方的长期静态密钥，服务间调用时随请求头出示，简单但需安全保管和轮换。',
    meaningEn: 'A long-lived static secret a caller presents on each request, simple for service-to-service auth but requiring safe storage and rotation.',
  },
  {
    label: 'OAuth',
    aliases: ['OAuth', 'OAuth2', 'OAuth 2.0'],
    englishName: 'Open Authorization',
    meaning: '授权框架：用户不给密码，而是让第三方应用拿到限定范围的访问令牌。',
    meaningEn: 'An authorization framework where users grant apps scoped access tokens instead of sharing passwords.',
  },
  {
    label: 'mTLS',
    aliases: ['mTLS', 'mutual TLS'],
    englishName: 'Mutual TLS',
    meaning: '双向 TLS：客户端和服务端都出示证书互相验明身份，常用于服务网格内部调用。',
    meaningEn: 'Mutual TLS where both client and server present certificates, common for service-to-service auth inside a mesh.',
  },
  {
    label: 'Session Cookie',
    aliases: ['session cookie', 'session id', 'sessionid'],
    englishName: 'Session cookie',
    meaning: '服务端存会话状态，浏览器只带一个会话 ID Cookie；易失效但需要集中式会话存储。',
    meaningEn: 'The server keeps session state and the browser carries only a session-id cookie, easy to revoke but needing a shared session store.',
  },
  {
    label: 'CRDT',
    aliases: ['CRDT', 'CRDTs'],
    englishName: 'Conflict-free Replicated Data Type',
    meaning: '无冲突复制数据类型：把每个操作设计成可交换/可合并，多端并发编辑不需要中央协调也能收敛到同一结果。',
    meaningEn: 'A data type whose operations commute or merge deterministically, so concurrent edits on replicas converge without central coordination.',
  },
  {
    label: 'OT',
    aliases: ['OT', 'operational transform', 'operational transformation'],
    englishName: 'Operational Transformation',
    meaning: '操作变换：并发编辑时按对方已应用的操作改写自己的操作再应用，需要中央服务器定序，是 CRDT 的传统替代方案。',
    meaningEn: 'Rewrites concurrent edit operations against each other before applying, typically needing a central server to order them; the classic alternative to CRDTs.',
  },
];

const MAX_TERMS = 6;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstAliasHit(text: string, aliases: string[]): { index: number; length: number } | null {
  let best: { index: number; length: number } | null = null;
  for (const alias of aliases) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(alias)}(?=$|[^A-Za-z0-9])`, 'i');
    const match = text.match(pattern);
    if (!match || match.index == null) continue;
    const index = match.index + match[1].length;
    if (!best || index < best.index || (index === best.index && alias.length > best.length)) {
      best = { index, length: alias.length };
    }
  }
  return best;
}

function textForCard(card: Card) {
  return [
    card.scenario,
    card.q,
    card.text,
    ...(card.options ?? []),
    ...(card.steps ?? []),
  ]
    .filter(Boolean)
    .join('\n');
}

export function detectTerms(card: Card, limit = MAX_TERMS): TermHit[] {
  const text = textForCard(card);
  const hits: TermHit[] = [];
  for (const term of TERMS) {
    const hit = firstAliasHit(text, term.aliases);
    if (hit) hits.push({ ...term, index: hit.index, matchLength: hit.length });
  }
  // longest-match-wins: drop a hit whose span sits inside a longer hit's span
  // at the same position (e.g. HTTP matching inside HTTP/2)
  const kept = hits.filter(
    (h) =>
      !hits.some(
        (o) =>
          o !== h &&
          o.matchLength > h.matchLength &&
          o.index <= h.index &&
          h.index + h.matchLength <= o.index + o.matchLength,
      ),
  );
  return kept
    .sort((a, b) => a.index - b.index || a.label.localeCompare(b.label))
    .slice(0, limit);
}

const TCP_UDP_VISUAL: ConceptVisual = {
  id: 'tcp-udp',
  title: 'TCP vs UDP：可靠性和低延迟的交换',
  titleEn: 'TCP vs UDP: reliability versus low latency',
  bullets: [
    'TCP 像一通电话：先建连接，按顺序传字节，丢了会重传。',
    'UDP 像一叠明信片：直接发 datagram，可能丢、乱序，但少了握手和重传等待。',
    '面试里默认 TCP；只有实时音视频、游戏、遥测这类能容忍丢包的场景才主动论证 UDP。',
  ],
  bulletsEn: [
    'TCP gives reliable ordered delivery through connection state, ACKs, and retries.',
    'UDP sends independent datagrams with lower latency but no delivery or ordering guarantees.',
  ],
  diagram: `flowchart TB
  subgraph TCP["TCP mental model"]
    TC["Client"] -->|1. handshake| TS["Server"]
    TC -->|2. ordered byte stream| TS
    TS -->|ACK / retry missing data| TC
  end
  subgraph UDP["UDP mental model"]
    UC["Client"] -.->|packet 1| US["Server"]
    UC -.->|packet 2 may be lost| Drop["lost / ignored"]
    UC -.->|packet 3 may arrive early| US
  end`,
};

const WEBRTC_VISUAL: ConceptVisual = {
  id: 'webrtc',
  title: 'WebRTC：P2P 不是“不需要服务器”',
  titleEn: 'WebRTC: peer-to-peer still needs setup infrastructure',
  bullets: [
    '信令服务器负责让双方发现彼此、交换 candidate；它不一定转发媒体流。',
    'STUN 帮客户端知道自己的公网地址；TURN 是直连失败时的中继兜底。',
    '真正适合 WebRTC 的是音视频、屏幕共享、P2P 高频数据；普通实时通知通常用 SSE/WebSocket 更简单。',
  ],
  bulletsEn: [
    'Signaling exchanges connection metadata, STUN discovers public addresses, and TURN relays when direct paths fail.',
    'Use WebRTC when peer-to-peer media or high-frequency data is worth the operational complexity.',
  ],
  diagram: `flowchart LR
  A["Browser A"] --> Sig["Signaling server"]
  B["Browser B"] --> Sig
  A --> STUN["STUN<br/>discover public address"]
  B --> STUN
  A <-->|UDP media/data| B
  A -.-> TURN["TURN relay fallback"]
  B -.-> TURN`,
};

const CASSANDRA_VISUAL: ConceptVisual = {
  id: 'cassandra',
  title: 'Cassandra：masterless + 分区复制 + 写优化',
  titleEn: 'Cassandra: masterless partitioned replication with a write-optimized path',
  bullets: [
    '没有单一 master：任意节点都可以当 coordinator，按 partition key 找 token range 和副本。',
    '写入先到 commit log 保持持久性，再进 memtable，之后刷成不可变 SSTable。',
    '它擅长横向扩展大规模读写；代价是查询必须围绕 partition key 设计，join/强事务不是它的强项。',
  ],
  bulletsEn: [
    'Any node can coordinate a request; partition keys route data to replicated token ranges.',
    'Writes are optimized through commit log, memtable, immutable SSTables, and background compaction.',
  ],
  diagram: `flowchart LR
  Client["Client read/write"] --> Coord["Any node as coordinator<br/>(no master)"]
  Coord --> Ring["partition key -> token ring"]
  Ring --> R1["Replica A"]
  Ring --> R2["Replica B"]
  Ring --> R3["Replica C"]
  R1 --> CL["Commit log<br/>durability"]
  R1 --> MT["Memtable<br/>in memory"]
  MT --> SS["SSTable<br/>immutable on disk"]
  R2 -.-> Scale["add nodes to scale out"]
  R3 -.-> Scale`,
};

const API_CHOICE_VISUAL: ConceptVisual = {
  id: 'api-choice',
  title: '协议选型：先看交互形态',
  titleEn: 'Protocol choice: start from the interaction shape',
  bullets: [
    '公开 CRUD API 默认 REST/HTTP；内部强类型服务调用常用 gRPC/RPC。',
    '单向服务端推送优先 SSE；高频双向消息选 WebSocket；P2P 音视频才考虑 WebRTC。',
  ],
  bulletsEn: [
    'Default to REST for public resource APIs, gRPC/RPC for internal typed service calls.',
    'Use SSE for one-way server push, WebSocket for bidirectional realtime, and WebRTC for peer-to-peer media.',
  ],
  diagram: `flowchart TD
  Need["What interaction do you need?"] --> CRUD["Public resource CRUD?"]
  CRUD -->|yes| REST["REST over HTTP"]
  Need --> Internal["Internal typed action?"]
  Internal -->|yes| GRPC["gRPC / RPC"]
  Need --> Realtime["Realtime updates?"]
  Realtime -->|server to client| SSE["SSE"]
  Realtime -->|two-way| WS["WebSocket"]
  Realtime -->|P2P media/data| RTC["WebRTC"]`,
};

const VISUAL_BY_LABEL: Record<string, ConceptVisual> = {
  Cassandra: CASSANDRA_VISUAL,
  'LSM tree': CASSANDRA_VISUAL,
  Memtable: CASSANDRA_VISUAL,
  SSTable: CASSANDRA_VISUAL,
  'Commit Log': CASSANDRA_VISUAL,
  Quorum: CASSANDRA_VISUAL,
  'Consistent Hashing': CASSANDRA_VISUAL,
  TCP: TCP_UDP_VISUAL,
  UDP: TCP_UDP_VISUAL,
  WebRTC: WEBRTC_VISUAL,
  SSE: API_CHOICE_VISUAL,
  WebSocket: API_CHOICE_VISUAL,
  gRPC: API_CHOICE_VISUAL,
  REST: API_CHOICE_VISUAL,
  RPC: API_CHOICE_VISUAL,
};

/**
 * The card's dominant topic wins: `terms` arrives sorted by first occurrence
 * in the card text, so the first visual-capable term decides — a card that
 * opens with TCP/UDP but mentions Cassandra later gets the TCP/UDP visual,
 * not whatever a fixed branch order preferred.
 */
export function chooseConceptVisual(terms: TermHit[]): ConceptVisual | null {
  for (const term of terms) {
    const visual = VISUAL_BY_LABEL[term.label];
    if (visual) return visual;
  }
  return null;
}
