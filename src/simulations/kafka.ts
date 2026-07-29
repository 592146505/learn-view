export type KafkaBrokerId = 'b1' | 'b2' | 'b3'
export type KafkaPartitionId = 0 | 1 | 2
export type KafkaConsumerGroupId = 'analytics' | 'billing'
export type KafkaConsumerId = 'analytics-c1' | 'analytics-c2' | 'billing-c1'
export type KafkaNodeId = 'producer' | KafkaBrokerId | KafkaConsumerId
export type KafkaBrokerStatus = 'up' | 'down'
export type KafkaReplicaRole = 'leader' | 'follower'
export type KafkaGroupStatus = 'empty' | 'rebalancing' | 'stable'
export type KafkaProducerStatus = 'idle' | 'routing' | 'waiting-replicas' | 'acked'
export type KafkaEventKind =
  | 'route'
  | 'produce'
  | 'replicate'
  | 'ack'
  | 'rebalance'
  | 'consume'
  | 'commit'
  | 'fault'
  | 'election'

export interface KafkaTopicConfig {
  readonly name: 'orders'
  readonly partitionCount: 3
  readonly replicationFactor: 3
}

export interface KafkaBrokerState {
  readonly id: KafkaBrokerId
  readonly status: KafkaBrokerStatus
}

export interface KafkaRecord {
  readonly offset: number
  readonly key: string
  readonly value: string
}

export interface KafkaReplicaState {
  readonly broker: KafkaBrokerId
  readonly role: KafkaReplicaRole
  /** The next offset after the last record stored on this replica. */
  readonly logEndOffset: number
  /** ISR membership; a replica can briefly lag while it remains in the ISR. */
  readonly inSync: boolean
}

export interface KafkaPartitionState {
  readonly id: KafkaPartitionId
  readonly leader: KafkaBrokerId
  readonly leaderEpoch: number
  readonly replicas: readonly KafkaReplicaState[]
  /** The next offset that is safe for consumers to read. */
  readonly highWatermark: number
  readonly records: readonly KafkaRecord[]
}

export type KafkaPartitionOffsets = Readonly<Record<KafkaPartitionId, number>>
export type KafkaConsumerPositions = Readonly<Partial<Record<KafkaPartitionId, number>>>

export interface KafkaConsumerMemberState {
  readonly id: KafkaConsumerId
  readonly assignments: readonly KafkaPartitionId[]
  /** Local next-fetch offsets; these can be ahead of the group's committed offsets. */
  readonly positions: KafkaConsumerPositions
}

export interface KafkaConsumerGroupState {
  readonly id: KafkaConsumerGroupId
  readonly coordinator: KafkaBrokerId
  readonly generation: number
  readonly status: KafkaGroupStatus
  readonly members: readonly KafkaConsumerMemberState[]
  /** Group-scoped next offsets. Different groups never share this map. */
  readonly committedOffsets: KafkaPartitionOffsets
}

export interface KafkaPendingRecord {
  readonly key: string
  readonly value: string
  readonly partition: KafkaPartitionId
  readonly offset: number
}

export interface KafkaProduceAcknowledgement {
  readonly partition: KafkaPartitionId
  readonly offset: number
}

export interface KafkaProducerState {
  readonly status: KafkaProducerStatus
  readonly current: KafkaPendingRecord | null
  readonly acknowledgements: readonly KafkaProduceAcknowledgement[]
}

export interface KafkaEventRoute {
  readonly from: KafkaNodeId
  readonly to: KafkaNodeId
}

export interface KafkaEvent {
  readonly route: KafkaEventRoute | null
  readonly label: string
  readonly kind: KafkaEventKind
  readonly partition: KafkaPartitionId | null
  readonly group: KafkaConsumerGroupId | null
}

export interface KafkaProtocolState {
  readonly topic: KafkaTopicConfig
  readonly brokers: readonly KafkaBrokerState[]
  readonly partitions: readonly KafkaPartitionState[]
  readonly producer: KafkaProducerState
  readonly groups: readonly KafkaConsumerGroupState[]
}

export interface KafkaFrame extends KafkaProtocolState {
  readonly id: string
  readonly phase: string
  readonly title: string
  readonly description: string
  readonly context: string
  readonly event: KafkaEvent
  readonly ruleTitle: string
  readonly rule: string
}

export const kafkaBrokerIds = ['b1', 'b2', 'b3'] as const satisfies readonly KafkaBrokerId[]

export function isKafkaBrokerId(nodeId: KafkaNodeId): nodeId is KafkaBrokerId {
  return kafkaBrokerIds.some((brokerId) => brokerId === nodeId)
}

export const kafkaTopic: KafkaTopicConfig = {
  name: 'orders',
  partitionCount: 3,
  replicationFactor: 3,
}

const emptyOffsets = (): KafkaPartitionOffsets => ({ 0: 0, 1: 0, 2: 0 })

function replica(
  broker: KafkaBrokerId,
  role: KafkaReplicaRole,
): KafkaReplicaState {
  return { broker, role, logEndOffset: 0, inSync: true }
}

const initialState: KafkaProtocolState = {
  topic: kafkaTopic,
  brokers: kafkaBrokerIds.map((id) => ({ id, status: 'up' })),
  partitions: [
    {
      id: 0,
      leader: 'b1',
      leaderEpoch: 0,
      replicas: [replica('b1', 'leader'), replica('b2', 'follower'), replica('b3', 'follower')],
      highWatermark: 0,
      records: [],
    },
    {
      id: 1,
      leader: 'b2',
      leaderEpoch: 0,
      replicas: [replica('b2', 'leader'), replica('b3', 'follower'), replica('b1', 'follower')],
      highWatermark: 0,
      records: [],
    },
    {
      id: 2,
      leader: 'b3',
      leaderEpoch: 0,
      replicas: [replica('b3', 'leader'), replica('b1', 'follower'), replica('b2', 'follower')],
      highWatermark: 0,
      records: [],
    },
  ],
  producer: { status: 'idle', current: null, acknowledgements: [] },
  groups: [
    {
      id: 'analytics',
      coordinator: 'b2',
      generation: 0,
      status: 'empty',
      members: [],
      committedOffsets: emptyOffsets(),
    },
    {
      id: 'billing',
      coordinator: 'b2',
      generation: 0,
      status: 'empty',
      members: [],
      committedOffsets: emptyOffsets(),
    },
  ],
}

const partitionRule = '有 key 的记录使用 Kafka 默认 Murmur2 哈希，并在分区数不变时稳定落到同一分区。'
const replicationRule = 'acks=all 要求当前 ISR 中的副本都追上该记录；随后 Leader 推进高水位并返回 ProduceResponse。'
const groupRule = '同一消费组内一个分区最多分配给一个成员；不同消费组会各自获得完整分区集合。'
const offsetRule = '消费位置属于消费者进程，提交 offset 属于消费组；analytics 与 billing 的 offset 彼此独立。'
const failoverRule = 'Leader 不可用时，控制器只能从 ISR 中选择已同步副本，并通过更大的 leader epoch 发布新元数据。'

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach((child) => deepFreeze(child))
    Object.freeze(value)
  }
  return value
}

/** Kafka-compatible Murmur2 partitioning for UTF-8 string keys. */
export function kafkaPartitionForKey(
  key: string,
  partitionCount: number = kafkaTopic.partitionCount,
): number {
  if (!Number.isInteger(partitionCount) || partitionCount <= 0) {
    throw new RangeError('partitionCount must be a positive integer')
  }

  const bytes = new TextEncoder().encode(key)
  const seed = 0x9747b28c | 0
  const multiplier = 0x5bd1e995 | 0
  let remaining = bytes.length
  let index = 0
  let hash = (seed ^ remaining) | 0

  while (remaining >= 4) {
    let chunk =
      (bytes[index] & 0xff) |
      ((bytes[index + 1] & 0xff) << 8) |
      ((bytes[index + 2] & 0xff) << 16) |
      ((bytes[index + 3] & 0xff) << 24)

    chunk = Math.imul(chunk, multiplier)
    chunk ^= chunk >>> 24
    chunk = Math.imul(chunk, multiplier)
    hash = Math.imul(hash, multiplier)
    hash ^= chunk
    index += 4
    remaining -= 4
  }

  switch (remaining) {
    case 3:
      hash ^= (bytes[index + 2] & 0xff) << 16
    // Falls through to include the remaining bytes, matching Kafka's implementation.
    case 2:
      hash ^= (bytes[index + 1] & 0xff) << 8
    // Falls through to include the final byte.
    case 1:
      hash ^= bytes[index] & 0xff
      hash = Math.imul(hash, multiplier)
  }

  hash ^= hash >>> 13
  hash = Math.imul(hash, multiplier)
  hash ^= hash >>> 15

  return (hash & 0x7fffffff) % partitionCount
}

type KafkaFrameMeta = Omit<KafkaFrame, keyof KafkaProtocolState>

function updatePartition(
  state: KafkaProtocolState,
  partitionId: KafkaPartitionId,
  update: (partition: KafkaPartitionState) => KafkaPartitionState,
): KafkaProtocolState {
  return {
    ...state,
    partitions: state.partitions.map((partition) =>
      partition.id === partitionId ? update(partition) : partition,
    ),
  }
}

function updateReplica(
  partition: KafkaPartitionState,
  broker: KafkaBrokerId,
  update: (replicaState: KafkaReplicaState) => KafkaReplicaState,
): KafkaPartitionState {
  return {
    ...partition,
    replicas: partition.replicas.map((replicaState) =>
      replicaState.broker === broker ? update(replicaState) : replicaState,
    ),
  }
}

function updateGroup(
  state: KafkaProtocolState,
  groupId: KafkaConsumerGroupId,
  update: (group: KafkaConsumerGroupState) => KafkaConsumerGroupState,
): KafkaProtocolState {
  return {
    ...state,
    groups: state.groups.map((group) => (group.id === groupId ? update(group) : group)),
  }
}

function updateMember(
  group: KafkaConsumerGroupState,
  consumerId: KafkaConsumerId,
  update: (member: KafkaConsumerMemberState) => KafkaConsumerMemberState,
): KafkaConsumerGroupState {
  return {
    ...group,
    members: group.members.map((member) => (member.id === consumerId ? update(member) : member)),
  }
}

let state = initialState
const frames: KafkaFrame[] = []

function capture(meta: KafkaFrameMeta) {
  frames.push(deepFreeze({ ...state, ...meta }))
}

function routeRecord(record: KafkaPendingRecord, leader: KafkaBrokerId) {
  state = {
    ...state,
    producer: { ...state.producer, status: 'routing', current: record },
  }
  capture({
    id: `${record.key}-routed`,
    phase: 'Key 路由',
    title: `${record.key} 经 Murmur2 定位到 P${record.partition}`,
    description: `Producer 只根据 key 和分区数计算目标分区；P${record.partition} 的元数据指出当前 Leader 是 ${leader.toUpperCase()}。`,
    context: `positive(murmur2("${record.key}")) % 3 = ${record.partition}`,
    event: {
      route: null,
      label: `${record.key} → P${record.partition}`,
      kind: 'route',
      partition: record.partition,
      group: null,
    },
    ruleTitle: '相同 key 稳定进入同一分区',
    rule: partitionRule,
  })
}

function appendRecord(record: KafkaPendingRecord, leader: KafkaBrokerId) {
  state = updatePartition(state, record.partition, (partition) => {
    const storedRecord: KafkaRecord = {
      offset: record.offset,
      key: record.key,
      value: record.value,
    }
    const withRecord = { ...partition, records: [...partition.records, storedRecord] }
    return updateReplica(withRecord, leader, (leaderReplica) => ({
      ...leaderReplica,
      logEndOffset: record.offset + 1,
    }))
  })
  state = { ...state, producer: { ...state.producer, status: 'waiting-replicas' } }
  capture({
    id: `${record.key}-appended`,
    phase: 'Leader 追加',
    title: `${leader.toUpperCase()} 把记录追加到 P${record.partition}`,
    description: `Leader 为记录分配 offset ${record.offset}，自己的 LEO 前进到 ${record.offset + 1}；Follower 尚未复制，所以暂不响应 acks=all。`,
    context: `P${record.partition} · offset ${record.offset} · acks=all`,
    event: {
      route: { from: 'producer', to: leader },
      label: `ProduceRequest · ${record.key}`,
      kind: 'produce',
      partition: record.partition,
      group: null,
    },
    ruleTitle: '只有 Leader 接受该分区写入',
    rule: replicationRule,
  })
}

function replicateRecord(record: KafkaPendingRecord, leader: KafkaBrokerId, follower: KafkaBrokerId) {
  state = updatePartition(state, record.partition, (partition) =>
    updateReplica(partition, follower, (replicaState) => ({
      ...replicaState,
      logEndOffset: record.offset + 1,
    })),
  )
  capture({
    id: `${record.key}-replicated-${follower}`,
    phase: 'Follower 复制',
    title: `${follower.toUpperCase()} 从 ${leader.toUpperCase()} 复制 P${record.partition} offset ${record.offset}`,
    description: `这一次副本拉取只推进 ${follower.toUpperCase()} 的 LEO；其他副本和高水位不会被这条复制消息同时改写。`,
    context: `P${record.partition} · ${follower.toUpperCase()} LEO ${record.offset + 1}`,
    event: {
      route: { from: leader, to: follower },
      label: `FetchResponse · offset ${record.offset}`,
      kind: 'replicate',
      partition: record.partition,
      group: null,
    },
    ruleTitle: '副本逐个追上 Leader 日志',
    rule: replicationRule,
  })
}

function advanceHighWatermark(record: KafkaPendingRecord) {
  state = updatePartition(state, record.partition, (partition) => ({
    ...partition,
    highWatermark: record.offset + 1,
  }))
  capture({
    id: `${record.key}-hw-advanced`,
    phase: '提交记录',
    title: `P${record.partition} 的 ISR 已全部复制 offset ${record.offset}`,
    description: `Leader 观察到当前 ISR 的 LEO 都至少为 ${record.offset + 1}，于是把高水位推进到 ${record.offset + 1}。`,
    context: `P${record.partition} · HW ${record.offset} → ${record.offset + 1}`,
    event: {
      route: null,
      label: `high watermark → ${record.offset + 1}`,
      kind: 'ack',
      partition: record.partition,
      group: null,
    },
    ruleTitle: '高水位以内的记录才对消费者可见',
    rule: replicationRule,
  })
}

function acknowledgeRecord(record: KafkaPendingRecord, leader: KafkaBrokerId) {
  state = {
    ...state,
    producer: {
      ...state.producer,
      status: 'acked',
      acknowledgements: [
        ...state.producer.acknowledgements,
        { partition: record.partition, offset: record.offset },
      ],
    },
  }
  capture({
    id: `${record.key}-acked`,
    phase: '生产确认',
    title: `${leader.toUpperCase()} 向 Producer 确认 P${record.partition} offset ${record.offset}`,
    description: 'ProduceResponse 返回后，Producer 才把这条 acks=all 写入视为成功。',
    context: `P${record.partition} · offset ${record.offset} · acknowledged`,
    event: {
      route: { from: leader, to: 'producer' },
      label: `ProduceResponse · P${record.partition}@${record.offset}`,
      kind: 'ack',
      partition: record.partition,
      group: null,
    },
    ruleTitle: 'ACK 晚于 ISR 复制完成',
    rule: replicationRule,
  })
}

function produce(
  record: KafkaPendingRecord,
  leader: KafkaBrokerId,
  followers: readonly [KafkaBrokerId, KafkaBrokerId] | readonly [KafkaBrokerId],
) {
  routeRecord(record, leader)
  appendRecord(record, leader)
  followers.forEach((follower) => replicateRecord(record, leader, follower))
  advanceHighWatermark(record)
  acknowledgeRecord(record, leader)
}

function addMember(groupId: KafkaConsumerGroupId, consumerId: KafkaConsumerId) {
  state = updateGroup(state, groupId, (group) => ({
    ...group,
    status: 'rebalancing',
    members: [...group.members, { id: consumerId, assignments: [], positions: {} }],
  }))
  const group = state.groups.find(({ id }) => id === groupId)!
  capture({
    id: `${consumerId}-joins`,
    phase: '加入消费组',
    title: `${consumerId} 加入 ${groupId} 组`,
    description: `${groupId} 进入再均衡；在新 generation 的分配下发前，成员不会同时开始消费分区。`,
    context: `${groupId} · members ${group.members.length} · rebalancing`,
    event: {
      route: { from: consumerId, to: group.coordinator },
      label: `JoinGroup · ${groupId}`,
      kind: 'rebalance',
      partition: null,
      group: groupId,
    },
    ruleTitle: '成员变化触发组内再均衡',
    rule: groupRule,
  })
}

function assignGroup(
  groupId: KafkaConsumerGroupId,
  assignments: Readonly<Partial<Record<KafkaConsumerId, readonly KafkaPartitionId[]>>>,
) {
  state = updateGroup(state, groupId, (group) => ({
    ...group,
    generation: group.generation + 1,
    status: 'stable',
    members: group.members.map((member) => ({
      ...member,
      assignments: assignments[member.id] ?? [],
    })),
  }))
  const group = state.groups.find(({ id }) => id === groupId)!
  capture({
    id: `${groupId}-assigned`,
    phase: '分区分配',
    title: `${groupId} 完成 generation ${group.generation} 分配`,
    description:
      groupId === 'analytics'
        ? 'analytics-c1 获得 P0、P2，analytics-c2 获得 P1；组内没有分区被重复消费。'
        : 'billing 只有一个成员，因此 billing-c1 独自获得 P0、P1、P2。',
    context: `${groupId} · generation ${group.generation} · stable`,
    event: {
      route: null,
      label: group.members
        .map(({ id, assignments: memberAssignments }) => `${id}: ${memberAssignments.map((id) => `P${id}`).join(', ')}`)
        .join(' · '),
      kind: 'rebalance',
      partition: null,
      group: groupId,
    },
    ruleTitle: '组内分摊，组间隔离',
    rule: groupRule,
  })
}

function fetchRecord(
  groupId: KafkaConsumerGroupId,
  consumerId: KafkaConsumerId,
  partitionId: KafkaPartitionId,
  leader: KafkaBrokerId,
  offset: number,
) {
  state = updateGroup(state, groupId, (group) =>
    updateMember(group, consumerId, (member) => ({
      ...member,
      positions: { ...member.positions, [partitionId]: offset + 1 },
    })),
  )
  capture({
    id: `${groupId}-fetch-p${partitionId}-o${offset}`,
    phase: '拉取记录',
    title: `${consumerId} 从 P${partitionId} 读取 offset ${offset}`,
    description: `消费者本地 position 前进到 ${offset + 1}，但 ${groupId} 的已提交 offset 暂时不变。`,
    context: `${groupId} · P${partitionId} position ${offset + 1}`,
    event: {
      route: { from: leader, to: consumerId },
      label: `FetchResponse · P${partitionId}@${offset}`,
      kind: 'consume',
      partition: partitionId,
      group: groupId,
    },
    ruleTitle: '读取和提交 offset 是两个动作',
    rule: offsetRule,
  })
}

function commitOffset(
  groupId: KafkaConsumerGroupId,
  consumerId: KafkaConsumerId,
  partitionId: KafkaPartitionId,
  nextOffset: number,
) {
  state = updateGroup(state, groupId, (group) => ({
    ...group,
    committedOffsets: { ...group.committedOffsets, [partitionId]: nextOffset },
  }))
  const coordinator = state.groups.find(({ id }) => id === groupId)!.coordinator
  capture({
    id: `${groupId}-commit-p${partitionId}-o${nextOffset}`,
    phase: '提交 Offset',
    title: `${groupId} 提交 P${partitionId} 的 next offset ${nextOffset}`,
    description: `只有 ${groupId} 的 __consumer_offsets 记录发生变化，另一个消费组仍保留自己的进度。`,
    context: `${groupId} · P${partitionId} committed ${nextOffset}`,
    event: {
      route: { from: consumerId, to: coordinator },
      label: `OffsetCommit · P${partitionId}=${nextOffset}`,
      kind: 'commit',
      partition: partitionId,
      group: groupId,
    },
    ruleTitle: '提交 offset 以 group.id 为命名空间',
    rule: offsetRule,
  })
}

capture({
  id: 'topology-ready',
  phase: '拓扑准备',
  title: 'orders 建立 3 分区、每分区 3 副本',
  description: 'P0、P1、P2 的 Leader 分别位于 B1、B2、B3；每个分区还在另外两个 Broker 保留 Follower。',
  context: 'brokers 3 · partitions 3 · replication.factor 3',
  event: {
    route: null,
    label: 'orders · P0→B1 · P1→B2 · P2→B3',
    kind: 'route',
    partition: null,
    group: null,
  },
  ruleTitle: 'Leader 分散承担读写流量',
  rule: '副本因子 3 表示每个分区在 3 个 Broker 上各有一份日志，而不是把一条消息写进 3 个分区。',
})

produce(
  { key: 'order-1001', value: '{"amount":128}', partition: 0, offset: 0 },
  'b1',
  ['b2', 'b3'],
)
produce(
  { key: 'order-1003', value: '{"amount":256}', partition: 1, offset: 0 },
  'b2',
  ['b3', 'b1'],
)
produce(
  { key: 'order-1009', value: '{"amount":512}', partition: 2, offset: 0 },
  'b3',
  ['b1', 'b2'],
)

addMember('analytics', 'analytics-c1')
addMember('analytics', 'analytics-c2')
assignGroup('analytics', { 'analytics-c1': [0, 2], 'analytics-c2': [1] })
addMember('billing', 'billing-c1')
assignGroup('billing', { 'billing-c1': [0, 1, 2] })

fetchRecord('analytics', 'analytics-c1', 0, 'b1', 0)
commitOffset('analytics', 'analytics-c1', 0, 1)
fetchRecord('analytics', 'analytics-c2', 1, 'b2', 0)
commitOffset('analytics', 'analytics-c2', 1, 1)
fetchRecord('analytics', 'analytics-c1', 2, 'b3', 0)
commitOffset('analytics', 'analytics-c1', 2, 1)

fetchRecord('billing', 'billing-c1', 0, 'b1', 0)
commitOffset('billing', 'billing-c1', 0, 1)
fetchRecord('billing', 'billing-c1', 1, 'b2', 0)
commitOffset('billing', 'billing-c1', 1, 1)
fetchRecord('billing', 'billing-c1', 2, 'b3', 0)
commitOffset('billing', 'billing-c1', 2, 1)

state = {
  ...state,
  brokers: state.brokers.map((broker) =>
    broker.id === 'b1' ? { ...broker, status: 'down' } : broker,
  ),
}
capture({
  id: 'broker-b1-stops',
  phase: 'Broker 故障',
  title: 'B1 突然停止响应',
  description: 'P0 的真实 Leader 已不可达，但控制器元数据暂时仍指向 B1；B1 上的三份本地日志不会凭空消失。',
  context: 'B1 · connection lost',
  event: {
    route: null,
    label: 'B1 → DOWN',
    kind: 'fault',
    partition: null,
    group: null,
  },
  ruleTitle: '真实故障先于元数据切换',
  rule: failoverRule,
})

state = updatePartition(state, 0, (partition) => ({
  ...partition,
  leader: 'b2',
  leaderEpoch: partition.leaderEpoch + 1,
  replicas: partition.replicas.map((replicaState) => ({
    ...replicaState,
    role: replicaState.broker === 'b2' ? 'leader' : 'follower',
    inSync: replicaState.broker !== 'b1',
  })),
}))
capture({
  id: 'p0-elects-b2',
  phase: 'Leader 切换',
  title: '控制器从 P0 的 ISR 中晋升 B2',
  description: 'B2 与 B3 都拥有 offset 0；控制器选择 B2，移除不可达的 B1，并把 P0 的 leader epoch 从 0 增加到 1。',
  context: 'P0 · Leader B1 → B2 · epoch 1',
  event: {
    route: null,
    label: 'P0 Leader=B2 · ISR={B2,B3}',
    kind: 'election',
    partition: 0,
    group: null,
  },
  ruleTitle: '只晋升已同步副本',
  rule: failoverRule,
})

for (const partitionId of [1, 2] as const) {
  state = updatePartition(state, partitionId, (partition) =>
    updateReplica(partition, 'b1', (replicaState) => ({ ...replicaState, inSync: false })),
  )
  const leader = state.partitions.find(({ id }) => id === partitionId)!.leader
  capture({
    id: `p${partitionId}-removes-b1-from-isr`,
    phase: 'ISR 收缩',
    title: `P${partitionId} 的 Leader 将 B1 移出 ISR`,
    description: `${leader.toUpperCase()} 仍是 P${partitionId} 的 Leader；这一步只更新该分区的 ISR，不会改动其他分区。`,
    context: `P${partitionId} · ISR={${leader.toUpperCase()},${partitionId === 1 ? 'B3' : 'B2'}}`,
    event: {
      route: null,
      label: `P${partitionId} · B1 leaves ISR`,
      kind: 'fault',
      partition: partitionId,
      group: null,
    },
    ruleTitle: 'ISR 按分区独立维护',
    rule: failoverRule,
  })
}

produce(
  { key: 'order-1023', value: '{"amount":1024}', partition: 0, offset: 1 },
  'b2',
  ['b3'],
)

fetchRecord('analytics', 'analytics-c1', 0, 'b2', 1)
commitOffset('analytics', 'analytics-c1', 0, 2)

export const kafkaFrames: readonly KafkaFrame[] = deepFreeze(frames)
