export type ClusterNodeId = 'client' | 'm1' | 'm2' | 'm3' | 'r1' | 'r2' | 'r3'
export type ClusterObserver = 'm1' | 'm3' | 'r2'
export type ClusterEventKind = 'probe' | 'confirm' | 'vote' | 'decision' | 'command' | 'sync' | 'fault'
export type ClusterFailureState = 'OK' | 'PFAIL' | 'FAIL'
export type ClusterReplicaRole = 'replica' | 'candidate' | 'master'
export type ClusterState = 'ok' | 'fail'
export type ClusterSlotOwner = 'm2' | 'r2'
export type ClusterViews<T> = Readonly<Record<ClusterObserver, T>>

export interface ClusterEventRoute {
  from: ClusterNodeId
  to: ClusterNodeId
}

export interface ClusterEvent {
  route: ClusterEventRoute | null
  label: string
  kind: ClusterEventKind
}

export interface ClusterProtocolState {
  m2Reachability: 'up' | 'down'
  m2Views: ClusterViews<ClusterFailureState>
  clusterStates: ClusterViews<ClusterState>
  slotOwners: ClusterViews<ClusterSlotOwner>
  /** Quorum evidence known by M1, including M1's own local PFAIL judgment. */
  failureReports: number
  /** Authorization acknowledgements already processed locally by R2. */
  votes: number
  /** The failover election epoch initiated by R2. */
  currentEpoch: number
  r2Role: ClusterReplicaRole
  r2ConfigEpoch: number
}

export interface ClusterFrame extends ClusterProtocolState {
  id: string
  observer: ClusterObserver
  phase: string
  title: string
  description: string
  context: string
  event: ClusterEvent
  ruleTitle: string
  rule: string
}

export const masterConfigEpochs = {
  m1: 5,
  m2: 7,
  m3: 6,
} as const

const routingRule = '客户端按 CRC16 哈希槽路由；请求到达错误主节点时，由该节点返回 MOVED，客户端自行重试。'
const failureRule = 'PFAIL 是观察节点的本地判断；收到其他主节点的 PFAIL 报告不会直接改写自己的本地判断。'
const failRule = '负责槽位的主节点达到多数派故障证据后，判定节点先在本地标记 FAIL，再用 FAIL 消息传播结论。'
const electionRule = '副本获得负责槽位主节点的多数授权后，才可以晋升；授权消息抵达后还必须先在本地计票。'
const epochRule = 'currentEpoch 标识选举轮次；获胜副本取得新的 configEpoch，并逐节点传播新的槽位所有权。'

const stableState: ClusterProtocolState = {
  m2Reachability: 'up',
  m2Views: { m1: 'OK', m3: 'OK', r2: 'OK' },
  clusterStates: { m1: 'ok', m3: 'ok', r2: 'ok' },
  slotOwners: { m1: 'm2', m3: 'm2', r2: 'm2' },
  failureReports: 0,
  votes: 0,
  currentEpoch: 7,
  r2Role: 'replica',
  r2ConfigEpoch: 0,
}

const m2DownState: ClusterProtocolState = {
  ...stableState,
  m2Reachability: 'down',
}

const m1PfailState: ClusterProtocolState = {
  ...m2DownState,
  m2Views: { ...m2DownState.m2Views, m1: 'PFAIL' },
  failureReports: 1,
}

const m3PfailState: ClusterProtocolState = {
  ...m1PfailState,
  m2Views: { ...m1PfailState.m2Views, m3: 'PFAIL' },
}

const m1FailState: ClusterProtocolState = {
  ...m3PfailState,
  m2Views: { ...m3PfailState.m2Views, m1: 'FAIL' },
  clusterStates: { ...m3PfailState.clusterStates, m1: 'fail' },
  failureReports: 2,
}

const r2FailState: ClusterProtocolState = {
  ...m1FailState,
  m2Views: { ...m1FailState.m2Views, r2: 'FAIL' },
  clusterStates: { ...m1FailState.clusterStates, r2: 'fail' },
}

const allFailState: ClusterProtocolState = {
  ...r2FailState,
  m2Views: { ...r2FailState.m2Views, m3: 'FAIL' },
  clusterStates: { m1: 'fail', m3: 'fail', r2: 'fail' },
}

const candidateState: ClusterProtocolState = {
  ...allFailState,
  r2Role: 'candidate',
}

const epochEightState: ClusterProtocolState = {
  ...candidateState,
  currentEpoch: 8,
}

const oneVoteState: ClusterProtocolState = {
  ...epochEightState,
  votes: 1,
}

const twoVotesState: ClusterProtocolState = {
  ...oneVoteState,
  votes: 2,
}

const r2PromotedState: ClusterProtocolState = {
  ...twoVotesState,
  clusterStates: { ...twoVotesState.clusterStates, r2: 'ok' },
  slotOwners: { ...twoVotesState.slotOwners, r2: 'r2' },
  r2Role: 'master',
  r2ConfigEpoch: 8,
}

const m1ConvergedState: ClusterProtocolState = {
  ...r2PromotedState,
  clusterStates: { ...r2PromotedState.clusterStates, m1: 'ok' },
  slotOwners: { ...r2PromotedState.slotOwners, m1: 'r2' },
}

const allConvergedState: ClusterProtocolState = {
  ...m1ConvergedState,
  clusterStates: { m1: 'ok', m3: 'ok', r2: 'ok' },
  slotOwners: { m1: 'r2', m3: 'r2', r2: 'r2' },
}

type ClusterFrameMeta = Omit<ClusterFrame, keyof ClusterProtocolState>

function defineFrame(state: ClusterProtocolState, meta: ClusterFrameMeta): ClusterFrame {
  return { ...state, ...meta }
}

export const clusterFrames: ClusterFrame[] = [
  defineFrame(stableState, {
    id: 'hash-slot',
    observer: 'm1',
    phase: '槽位分片',
    title: '键通过哈希标签定位到 slot 8000',
    description: 'cart:{42} 只对花括号中的 42 计算 CRC16，结果落在 M2 当前负责的槽位范围。',
    context: 'CRC16("42") % 16384',
    event: { route: null, label: 'CRC16("42") mod 16384 = 8000', kind: 'decision' },
    ruleTitle: '16384 个槽位分布在主节点上',
    rule: routingRule,
  }),
  defineFrame(stableState, {
    id: 'client-get-m1',
    observer: 'm1',
    phase: '客户端路由',
    title: '客户端先向 M1 发送 GET',
    description: '客户端尚未缓存 slot 8000 的地址，因此先把命令发送给一个已知主节点 M1。',
    context: 'client cache · miss',
    event: { route: { from: 'client', to: 'm1' }, label: 'GET cart:{42}', kind: 'command' },
    ruleTitle: '客户端可以先连接任意已知节点',
    rule: routingRule,
  }),
  defineFrame(stableState, {
    id: 'm1-moved-m2',
    observer: 'm1',
    phase: '客户端路由',
    title: 'M1 返回 M2 的 MOVED 地址',
    description: 'M1 不代理数据命令，而是把 slot 8000 的当前所有者 M2 返回给客户端。',
    context: 'slot 8000 · owner M2',
    event: { route: { from: 'm1', to: 'client' }, label: 'MOVED 8000 M2:6379', kind: 'confirm' },
    ruleTitle: 'MOVED 是永久重定向提示',
    rule: routingRule,
  }),
  defineFrame(stableState, {
    id: 'client-get-m2',
    observer: 'm1',
    phase: '客户端路由',
    title: '客户端按 MOVED 地址访问 M2',
    description: '客户端重试相同命令，消息这次直接到达 slot 8000 的所有者。',
    context: 'client route · slot 8000 → M2',
    event: { route: { from: 'client', to: 'm2' }, label: 'GET cart:{42}', kind: 'command' },
    ruleTitle: '客户端负责执行重定向',
    rule: routingRule,
  }),
  defineFrame(m2DownState, {
    id: 'm2-stops',
    observer: 'r2',
    phase: '真实故障',
    title: 'M2 停止响应',
    description: '进程已经停止，但 M1、M3 和 R2 的本地节点表尚未形成任何故障结论。',
    context: 'M2 · connection lost',
    event: { route: null, label: 'M2 进程停止 · 复制流中断', kind: 'fault' },
    ruleTitle: '真实故障先于协议判断发生',
    rule: failureRule,
  }),
  defineFrame(m1PfailState, {
    id: 'm1-marks-pfail',
    observer: 'm1',
    phase: 'PFAIL',
    title: 'M1 在本地把 M2 标记为 PFAIL',
    description: 'M1 的 cluster-node-timeout 到期；此时只有 M1 的节点表发生变化。',
    context: 'M1 view · evidence 1 / 3',
    event: { route: null, label: 'M1: M2 → PFAIL', kind: 'probe' },
    ruleTitle: 'PFAIL 是观察节点的本地怀疑',
    rule: failureRule,
  }),
  defineFrame(m1PfailState, {
    id: 'm1-gossips-pfail',
    observer: 'm3',
    phase: 'Gossip',
    title: 'M1 把 PFAIL 观点携带给 M3',
    description: 'PING 的 Gossip 条目携带 M1 对 M2 的判断；消息本身不改写任何节点的本地状态。',
    context: 'cluster bus · gossip copy',
    event: { route: { from: 'm1', to: 'm3' }, label: 'PING Gossip · M2:PFAIL', kind: 'confirm' },
    ruleTitle: 'Gossip 传播报告来源',
    rule: failureRule,
  }),
  defineFrame(m3PfailState, {
    id: 'm3-marks-pfail',
    observer: 'm3',
    phase: 'PFAIL',
    title: 'M3 独立把 M2 标记为 PFAIL',
    description: 'M3 自己的超时条件也已满足，因此在本地节点表形成独立判断。',
    context: 'M3 view · local timeout',
    event: { route: null, label: 'M3: M2 → PFAIL', kind: 'probe' },
    ruleTitle: '独立本地判断才能成为新的证据来源',
    rule: failureRule,
  }),
  defineFrame(m3PfailState, {
    id: 'm3-reports-pfail',
    observer: 'm1',
    phase: 'Gossip',
    title: 'M3 把自己的 PFAIL 报告发给 M1',
    description: '报告仍在总线上传输；M1 尚未把它计入多数派，也尚未标记 FAIL。',
    context: 'M1 known evidence · still 1 / 3',
    event: { route: { from: 'm3', to: 'm1' }, label: 'PING Gossip · M2:PFAIL', kind: 'confirm' },
    ruleTitle: '消息抵达后才能影响接收方',
    rule: failureRule,
  }),
  defineFrame(m1FailState, {
    id: 'm1-marks-fail',
    observer: 'm1',
    phase: 'FAIL 判定',
    title: 'M1 在本地以 2/3 证据标记 FAIL',
    description: 'M1 把自己的 PFAIL 判断与 M3 的有效报告合并，达到负责槽位主节点的多数派。',
    context: 'M1 view · evidence 2 / 3',
    event: { route: null, label: 'M1: quorum 2 / 3 · M2 → FAIL', kind: 'decision' },
    ruleTitle: '多数派判定首先只发生在 M1',
    rule: failRule,
  }),
  defineFrame(m1FailState, {
    id: 'm1-sends-fail-r2',
    observer: 'r2',
    phase: 'FAIL 广播',
    title: 'M1 向 R2 发送一条 FAIL 广播副本',
    description: '这是广播中的一条点对点副本；发送期间 R2 的本地视图仍保持 OK。',
    context: 'broadcast copy · M1 → R2',
    event: { route: { from: 'm1', to: 'r2' }, label: 'FAIL M2 · 广播副本', kind: 'fault' },
    ruleTitle: 'FAIL 消息传播已经形成的结论',
    rule: failRule,
  }),
  defineFrame(r2FailState, {
    id: 'r2-records-fail',
    observer: 'r2',
    phase: 'FAIL 收敛',
    title: 'R2 在本地记录 M2 为 FAIL',
    description: 'FAIL 消息已经抵达，R2 现在才更新自己的节点表并进入故障转移准备状态。',
    context: 'R2 view · M2 FAIL',
    event: { route: null, label: 'R2: M2 → FAIL', kind: 'decision' },
    ruleTitle: '接收方在消息抵达后更新本地状态',
    rule: failRule,
  }),
  defineFrame(r2FailState, {
    id: 'm1-sends-fail-m3',
    observer: 'm3',
    phase: 'FAIL 广播',
    title: 'M1 向 M3 发送另一条 FAIL 广播副本',
    description: '广播的另一条副本正在送往 M3；M3 此刻仍只有本地 PFAIL。',
    context: 'broadcast copy · M1 → M3',
    event: { route: { from: 'm1', to: 'm3' }, label: 'FAIL M2 · 广播副本', kind: 'fault' },
    ruleTitle: '广播由多条总线消息传播',
    rule: failRule,
  }),
  defineFrame(allFailState, {
    id: 'm3-records-fail',
    observer: 'm3',
    phase: 'FAIL 收敛',
    title: 'M3 在本地记录 M2 为 FAIL',
    description: 'M3 接收广播副本后更新节点表；三个观察节点现在都认定 M2 已 FAIL。',
    context: 'M3 view · M2 FAIL',
    event: { route: null, label: 'M3: M2 → FAIL', kind: 'decision' },
    ruleTitle: '故障结论逐节点收敛',
    rule: failRule,
  }),
  defineFrame(candidateState, {
    id: 'r2-computes-delay',
    observer: 'r2',
    phase: '副本竞选',
    title: 'R2 校验新鲜度并计算 rank 0 延迟',
    description: 'R2 是 M2 唯一且数据足够新的副本；rank 0 的实际延迟包含随机抖动。',
    context: '500 ms + random(0..499 ms)',
    event: { route: null, label: 'offset rank 0 · delay 500-999 ms', kind: 'decision' },
    ruleTitle: '更完整的副本更早发起竞选',
    rule: electionRule,
  }),
  defineFrame(epochEightState, {
    id: 'r2-bumps-epoch',
    observer: 'r2',
    phase: '选举纪元',
    title: 'R2 在本地把 currentEpoch 增加到 8',
    description: 'R2 先开启新的选举轮次；此时仍是候选副本，configEpoch 也尚未获得。',
    context: 'currentEpoch 7 → 8',
    event: { route: null, label: 'R2 currentEpoch: 7 → 8', kind: 'decision' },
    ruleTitle: 'currentEpoch 标识授权轮次',
    rule: epochRule,
  }),
  defineFrame(epochEightState, {
    id: 'r2-requests-m1-vote',
    observer: 'r2',
    phase: '请求授权',
    title: 'R2 向 M1 发送授权请求',
    description: '这是 FAILOVER_AUTH_REQUEST 广播中发往 M1 的一条副本；R2 尚未收到任何授权。',
    context: 'request copy · currentEpoch 8',
    event: { route: { from: 'r2', to: 'm1' }, label: 'FAILOVER_AUTH_REQUEST · currentEpoch 8', kind: 'vote' },
    ruleTitle: '只有负责槽位的主节点能够授权',
    rule: electionRule,
  }),
  defineFrame(epochEightState, {
    id: 'm1-acks-r2',
    observer: 'm1',
    phase: '返回授权',
    title: 'M1 向 R2 返回授权 ACK',
    description: 'M1 在 epoch 8 尚未授权其他候选者，因此发回 ACK；R2 本地票数仍为 0。',
    context: 'M1 vote · epoch 8',
    event: { route: { from: 'm1', to: 'r2' }, label: 'FAILOVER_AUTH_ACK · currentEpoch 8', kind: 'vote' },
    ruleTitle: '主节点每个 epoch 最多授权一次',
    rule: electionRule,
  }),
  defineFrame(oneVoteState, {
    id: 'r2-counts-m1-vote',
    observer: 'r2',
    phase: '本地计票',
    title: 'R2 收到并记录 M1 的授权',
    description: 'ACK 抵达后 R2 才把票数增加到 1；尚未达到 2/3 多数派。',
    context: 'R2 counted votes · 1 / 3',
    event: { route: null, label: 'R2 记录 M1 授权 · 1 / 3', kind: 'decision' },
    ruleTitle: '在途 ACK 不计入候选者票数',
    rule: electionRule,
  }),
  defineFrame(oneVoteState, {
    id: 'r2-requests-m3-vote',
    observer: 'r2',
    phase: '请求授权',
    title: 'R2 向 M3 发送授权请求',
    description: '这是授权请求广播中发往 M3 的另一条副本；已记录票数保持为 1。',
    context: 'request copy · currentEpoch 8',
    event: { route: { from: 'r2', to: 'm3' }, label: 'FAILOVER_AUTH_REQUEST · currentEpoch 8', kind: 'vote' },
    ruleTitle: '候选者向所有有槽主节点请求授权',
    rule: electionRule,
  }),
  defineFrame(oneVoteState, {
    id: 'm3-acks-r2',
    observer: 'm3',
    phase: '返回授权',
    title: 'M3 向 R2 返回授权 ACK',
    description: '第二个 ACK 正在传输，R2 尚未处理，因此本地票数依旧为 1。',
    context: 'M3 vote · epoch 8',
    event: { route: { from: 'm3', to: 'r2' }, label: 'FAILOVER_AUTH_ACK · currentEpoch 8', kind: 'vote' },
    ruleTitle: '消息抵达与本地计票是两个事件',
    rule: electionRule,
  }),
  defineFrame(twoVotesState, {
    id: 'r2-counts-m3-vote',
    observer: 'r2',
    phase: '本地计票',
    title: 'R2 记录第二票并达到多数派',
    description: 'R2 已处理 M1、M3 两个不同主节点的授权，但此刻仍保持 candidate 角色。',
    context: 'R2 counted votes · 2 / 3',
    event: { route: null, label: 'R2 记录 M3 授权 · 2 / 3', kind: 'decision' },
    ruleTitle: '先确认多数票，再执行晋升',
    rule: electionRule,
  }),
  defineFrame(r2PromotedState, {
    id: 'r2-promotes',
    observer: 'r2',
    phase: '副本晋升',
    title: 'R2 在本地晋升并取得 configEpoch 8',
    description: 'R2 切换为 MASTER，在自己的槽位表中接管 M2 的槽；M1、M3 尚未接受新配置。',
    context: 'R2 view · owner R2 · configEpoch 8',
    event: { route: null, label: 'R2 → MASTER · configEpoch 8', kind: 'decision' },
    ruleTitle: '获胜副本用选举 epoch 作为 configEpoch',
    rule: epochRule,
  }),
  defineFrame(r2PromotedState, {
    id: 'r2-announces-to-m1',
    observer: 'm1',
    phase: '配置传播',
    title: 'R2 向 M1 传播新的槽位声明',
    description: 'PONG 携带 R2 的槽位位图和 configEpoch 8；消息在途时 M1 仍认为所有者是 M2。',
    context: 'configuration copy · R2 → M1',
    event: { route: { from: 'r2', to: 'm1' }, label: 'PONG · slots 5461-10922 · configEpoch 8', kind: 'sync' },
    ruleTitle: '更大的 configEpoch 可以替换旧槽位声明',
    rule: epochRule,
  }),
  defineFrame(m1ConvergedState, {
    id: 'm1-accepts-r2-owner',
    observer: 'm1',
    phase: '槽位收敛',
    title: 'M1 在本地接受 R2 的槽位声明',
    description: 'M1 比较 configEpoch 8 与 M2 的 7，随后把相关槽位的所有者改为 R2。',
    context: 'M1 view · slot 8000 → R2',
    event: { route: null, label: 'M1: owner M2 → R2', kind: 'decision' },
    ruleTitle: '槽位表按观察节点逐步收敛',
    rule: epochRule,
  }),
  defineFrame(m1ConvergedState, {
    id: 'r2-announces-to-m3',
    observer: 'm3',
    phase: '配置传播',
    title: 'R2 向 M3 传播另一条配置副本',
    description: '同一配置通过另一条总线消息送往 M3；M3 的本地槽位表暂时仍指向 M2。',
    context: 'configuration copy · R2 → M3',
    event: { route: { from: 'r2', to: 'm3' }, label: 'PONG · slots 5461-10922 · configEpoch 8', kind: 'sync' },
    ruleTitle: '配置传播不会瞬间修改所有节点',
    rule: epochRule,
  }),
  defineFrame(allConvergedState, {
    id: 'm3-accepts-r2-owner',
    observer: 'm3',
    phase: '槽位收敛',
    title: 'M3 在本地接受 R2 的槽位声明',
    description: 'M3 更新完成后，M1、M3、R2 的本地槽位表都把 slot 8000 指向 R2。',
    context: 'all tracked views · slot 8000 → R2',
    event: { route: null, label: 'M3: owner M2 → R2', kind: 'decision' },
    ruleTitle: '三个本地视图最终一致',
    rule: epochRule,
  }),
  defineFrame(allConvergedState, {
    id: 'client-gets-stale-m2',
    observer: 'r2',
    phase: '旧缓存重试',
    title: '客户端仍按旧缓存向 M2 发送 GET',
    description: '客户端此前缓存的是 M2，因此故障转移后第一次请求仍然发往已经失联的旧主节点。',
    context: 'client cache · slot 8000 → M2',
    event: { route: { from: 'client', to: 'm2' }, label: 'GET cart:{42}', kind: 'command' },
    ruleTitle: '服务端拓扑不会主动改写客户端缓存',
    rule: routingRule,
  }),
  defineFrame(allConvergedState, {
    id: 'client-m2-connection-fails',
    observer: 'r2',
    phase: '连接失败',
    title: '客户端在本地确认 M2 连接失败',
    description: 'M2 无法返回 MOVED；客户端必须改选一个仍可连接的已知节点来重新发现槽位地址。',
    context: 'client · connection refused / timeout',
    event: { route: null, label: '客户端移除不可达地址 M2', kind: 'fault' },
    ruleTitle: '失联节点不能提供重定向',
    rule: routingRule,
  }),
  defineFrame(allConvergedState, {
    id: 'client-gets-m1',
    observer: 'm1',
    phase: '重新发现',
    title: '客户端改向可连接的 M1 发送 GET',
    description: 'M1 已经接受 configEpoch 8，因此能够返回 R2 的最新地址。',
    context: 'fallback node · M1',
    event: { route: { from: 'client', to: 'm1' }, label: 'GET cart:{42}', kind: 'command' },
    ruleTitle: '客户端可从任一可用节点重新发现路由',
    rule: routingRule,
  }),
  defineFrame(allConvergedState, {
    id: 'm1-moved-r2',
    observer: 'm1',
    phase: '刷新缓存',
    title: 'M1 返回 R2 的 MOVED 地址',
    description: 'M1 的本地槽位表已经收敛，因此把 slot 8000 的新所有者返回给客户端。',
    context: 'slot 8000 · owner R2',
    event: { route: { from: 'm1', to: 'client' }, label: 'MOVED 8000 R2:6379', kind: 'confirm' },
    ruleTitle: '客户端通过 MOVED 获得新地址',
    rule: routingRule,
  }),
  defineFrame(allConvergedState, {
    id: 'client-gets-r2',
    observer: 'r2',
    phase: '恢复请求',
    title: '客户端把 GET 重试到 R2',
    description: '客户端使用新的槽位地址，把原命令发送给已经晋升的 R2。',
    context: 'client route · slot 8000 → R2',
    event: { route: { from: 'client', to: 'r2' }, label: 'GET cart:{42}', kind: 'command' },
    ruleTitle: '命令最终到达新的槽位所有者',
    rule: routingRule,
  }),
  defineFrame(allConvergedState, {
    id: 'r2-returns-result',
    observer: 'r2',
    phase: '恢复服务',
    title: 'R2 向客户端返回查询结果',
    description: 'R2 已拥有 slot 8000 并完成读取，客户端的本次重试结束。',
    context: 'slot 8000 · served by R2',
    event: { route: { from: 'r2', to: 'client' }, label: 'GET result · HIT', kind: 'confirm' },
    ruleTitle: '故障转移完成后继续由副本数据提供服务',
    rule: routingRule,
  }),
]

export const clusterNodePositions = [
  { id: 'client' as ClusterNodeId, x: 75, y: 250, layer: 'client' as const },
  { id: 'm1' as ClusterNodeId, x: 270, y: 120, layer: 'master' as const },
  { id: 'm2' as ClusterNodeId, x: 525, y: 120, layer: 'master' as const },
  { id: 'm3' as ClusterNodeId, x: 780, y: 120, layer: 'master' as const },
  { id: 'r1' as ClusterNodeId, x: 270, y: 385, layer: 'replica' as const },
  { id: 'r2' as ClusterNodeId, x: 525, y: 385, layer: 'replica' as const },
  { id: 'r3' as ClusterNodeId, x: 780, y: 385, layer: 'replica' as const },
]
