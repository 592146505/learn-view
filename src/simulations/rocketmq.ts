export type RocketMessageId = 'tx1' | 'tx2' | 'tx3'
export type RocketNodeId = 'producer' | 'local-db' | 'broker' | 'consumer'
export type RocketTransactionState = 'pending' | 'committed' | 'rolled-back'
export type RocketProducerStatus = 'idle' | 'sending-half' | 'executing-local' | 'checking' | 'resolved'
export type RocketEventKind = 'local' | 'half' | 'half-ack' | 'database' | 'commit' | 'rollback' | 'check' | 'deliver' | 'fault'

export interface RocketMessage {
  readonly id: RocketMessageId
  readonly key: string
  readonly body: string
}

export interface RocketHalfMessage {
  readonly message: RocketMessage
  readonly state: 'pending'
  readonly checkCount: number
}

export interface RocketLocalTransaction {
  readonly messageId: RocketMessageId
  readonly orderId: string
  readonly state: RocketTransactionState
}

export interface RocketProducerState {
  readonly status: RocketProducerStatus
  readonly current: RocketMessage | null
  readonly localTransactions: readonly RocketLocalTransaction[]
  readonly checkerEnabled: true
}

export interface RocketBrokerState {
  readonly topic: 'OrderTransactionTopic'
  readonly topicType: 'TRANSACTION'
  readonly halfMessages: readonly RocketHalfMessage[]
  readonly ready: readonly RocketMessage[]
  readonly rolledBack: readonly RocketMessageId[]
}

export interface RocketConsumerState {
  readonly status: 'waiting' | 'processing'
  readonly current: RocketMessage | null
  readonly consumed: readonly RocketMessageId[]
}

export interface RocketEvent {
  readonly kind: RocketEventKind
  readonly route: { readonly from: RocketNodeId; readonly to: RocketNodeId } | null
  readonly label: string
  readonly messageId: RocketMessageId | null
}

export interface RocketFrame {
  readonly id: string
  readonly phase: string
  readonly title: string
  readonly description: string
  readonly context: string
  readonly producer: RocketProducerState
  readonly broker: RocketBrokerState
  readonly consumer: RocketConsumerState
  readonly event: RocketEvent
  readonly ruleTitle: string
  readonly rule: string
}

interface MutableProducerState {
  status: RocketProducerStatus
  current: RocketMessage | null
  localTransactions: RocketLocalTransaction[]
  checkerEnabled: true
}

interface MutableBrokerState {
  topic: 'OrderTransactionTopic'
  topicType: 'TRANSACTION'
  halfMessages: RocketHalfMessage[]
  ready: RocketMessage[]
  rolledBack: RocketMessageId[]
}

interface MutableConsumerState {
  status: 'waiting' | 'processing'
  current: RocketMessage | null
  consumed: RocketMessageId[]
}

const halfRule = 'Half Message 已被 Broker 接收，但在 Commit 前对 Consumer 不可见，不能当作普通可消费消息。'
const commitRule = '本地事务成功后，Producer 发送第二阶段 Commit；Broker 才把 Half Message 标记为可投递。'
const rollbackRule = '本地事务失败时发送 Rollback，Broker 终止该事务消息，Consumer 永远不会收到它。'
const checkRule = '第二阶段结果丢失或为 Unknown 时，Broker 回查 Producer；Checker 必须依据本地事务记录返回最终状态。'

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach((child) => deepFreeze(child))
    Object.freeze(value)
  }
  return value
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function message(id: RocketMessageId, orderId: string): RocketMessage {
  return {
    id,
    key: orderId,
    body: `{"orderId":"${orderId}","event":"ORDER_PAID"}`,
  }
}

const producer: MutableProducerState = {
  status: 'idle',
  current: null,
  localTransactions: [],
  checkerEnabled: true,
}

const broker: MutableBrokerState = {
  topic: 'OrderTransactionTopic',
  topicType: 'TRANSACTION',
  halfMessages: [],
  ready: [],
  rolledBack: [],
}

const consumer: MutableConsumerState = {
  status: 'waiting',
  current: null,
  consumed: [],
}

const frames: RocketFrame[] = []

function addFrame(
  id: string,
  phase: string,
  title: string,
  description: string,
  context: string,
  event: RocketEvent,
  ruleTitle: string,
  rule: string,
) {
  frames.push({
    id,
    phase,
    title,
    description,
    context,
    producer: clone(producer),
    broker: clone(broker),
    consumer: clone(consumer),
    event,
    ruleTitle,
    rule,
  })
}

function routedEvent(
  from: RocketNodeId,
  to: RocketNodeId,
  label: string,
  messageId: RocketMessageId,
  kind: RocketEventKind,
): RocketEvent {
  return { route: { from, to }, label, messageId, kind }
}

function updateLocal(messageId: RocketMessageId, state: RocketTransactionState) {
  const current = producer.localTransactions.find((transaction) => transaction.messageId === messageId)
  if (!current) throw new Error(`Missing local transaction: ${messageId}`)
  producer.localTransactions = producer.localTransactions.map((transaction) =>
    transaction.messageId === messageId ? { ...transaction, state } : transaction,
  )
}

function removeHalf(messageId: RocketMessageId) {
  broker.halfMessages = broker.halfMessages.filter(({ message }) => message.id !== messageId)
}

const committedMessage = message('tx1', 'ORDER-2001')
const rolledBackMessage = message('tx2', 'ORDER-2002')
const checkedMessage = message('tx3', 'ORDER-2003')

addFrame(
  'topology-ready',
  '拓扑准备',
  '创建 Transaction Topic 并配置事务检查器',
  'Producer 预绑定 OrderTransactionTopic，并提供按订单号查询本地事务结果的 Transaction Checker。',
  'MessageType=TRANSACTION · checker=enabled',
  { route: null, label: 'OrderTransactionTopic · TRANSACTION', messageId: null, kind: 'local' },
  '事务消息有专用 Topic 类型',
  'Transaction Message 需要 Transaction 类型 Topic；普通 Topic 不接受该消息类型。',
)

producer.status = 'sending-half'
producer.current = committedMessage
addFrame(
  'tx1-half-sent',
  '正常提交',
  'Producer 发送 TX1 Half Message',
  '订单 ORDER-2001 的事件先发给 Broker，本地事务尚未开始。',
  'beginTransaction → send half · TX1',
  routedEvent('producer', 'broker', 'Half Message · TX1', 'tx1', 'half'),
  '先发 Half 再执行本地事务',
  '只有 Broker 成功接收 Half Message 后，Producer 才进入本地事务阶段。',
)

broker.halfMessages.push({ message: committedMessage, state: 'pending', checkCount: 0 })
addFrame(
  'tx1-half-acked',
  '正常提交',
  'Broker 保存 TX1 并返回 Half Ack',
  'TX1 进入事务存储，状态为 pending；Consumer 此时看不到它。',
  'half ack · transaction pending',
  routedEvent('broker', 'producer', 'Half Ack · TX1', 'tx1', 'half-ack'),
  'Half Ack 不是最终提交',
  halfRule,
)

producer.status = 'executing-local'
producer.localTransactions.push({ messageId: 'tx1', orderId: 'ORDER-2001', state: 'pending' })
addFrame(
  'tx1-local-started',
  '正常提交',
  'Producer 开始订单本地事务',
  '订单服务更新 ORDER-2001 的支付状态；Half Message 继续保持不可消费。',
  'executeLocalTransaction · ORDER-2001',
  routedEvent('producer', 'local-db', 'BEGIN · ORDER-2001', 'tx1', 'database'),
  '本地事务独立执行',
  halfRule,
)

updateLocal('tx1', 'committed')
addFrame(
  'tx1-local-committed',
  '正常提交',
  '本地数据库提交 ORDER-2001',
  '订单状态已经提交，Producer 现在可以向 Broker 发送事务 Commit。',
  'DB COMMIT · ORDER-2001=PAID',
  routedEvent('local-db', 'producer', 'Local Commit · TX1', 'tx1', 'database'),
  '以本地事务结果决定消息状态',
  commitRule,
)

producer.status = 'resolved'
addFrame(
  'tx1-commit-sent',
  '正常提交',
  'Producer 发送 TX1 第二阶段 Commit',
  'Commit 把本地事务结果通知 Broker；它不是 Consumer 的消费确认。',
  'transaction.commit · TX1',
  routedEvent('producer', 'broker', 'Commit · TX1', 'tx1', 'commit'),
  'Commit 使消息可投递',
  commitRule,
)

removeHalf('tx1')
broker.ready.push(committedMessage)
addFrame(
  'tx1-ready',
  '正常提交',
  'Broker 将 TX1 标记为 Ready',
  'TX1 离开 Half 区域并进入可投递队列，Consumer 首次能够看到它。',
  'pending → ready · TX1',
  { route: null, label: 'TX1 对 Consumer 可见', messageId: 'tx1', kind: 'commit' },
  '可见性切换发生在 Broker',
  commitRule,
)

broker.ready.shift()
consumer.status = 'processing'
consumer.current = committedMessage
addFrame(
  'tx1-delivered',
  '正常提交',
  'Broker 向 Consumer 投递 TX1',
  '下游收到 ORDER-2001 已支付事件，可以开始积分、库存或物流处理。',
  'deliver · ORDER-2001',
  routedEvent('broker', 'consumer', 'Deliver · TX1', 'tx1', 'deliver'),
  '事务消息只保证上游最终一致',
  '下游消费仍需配置重试和幂等；事务消息不替代 Consumer 自身的可靠消费机制。',
)

consumer.status = 'waiting'
consumer.current = null
consumer.consumed.push('tx1')
producer.status = 'sending-half'
producer.current = rolledBackMessage
addFrame(
  'tx2-half-sent',
  '本地回滚',
  'Producer 发送 TX2 Half Message',
  'ORDER-2002 将演示本地事务失败后的 Rollback 分支。',
  'send half · TX2',
  routedEvent('producer', 'broker', 'Half Message · TX2', 'tx2', 'half'),
  'Rollback 前也先保存 Half',
  halfRule,
)

broker.halfMessages.push({ message: rolledBackMessage, state: 'pending', checkCount: 0 })
addFrame(
  'tx2-half-acked',
  '本地回滚',
  'Broker 保存 TX2 并返回 Half Ack',
  'TX2 暂存在事务存储中，对 Consumer 不可见。',
  'half ack · TX2 pending',
  routedEvent('broker', 'producer', 'Half Ack · TX2', 'tx2', 'half-ack'),
  'Pending 状态隔离下游',
  halfRule,
)

producer.status = 'executing-local'
producer.localTransactions.push({ messageId: 'tx2', orderId: 'ORDER-2002', state: 'pending' })
addFrame(
  'tx2-local-started',
  '本地回滚',
  'Producer 执行 ORDER-2002 本地事务',
  '数据库约束冲突导致这次支付更新无法提交。',
  'executeLocalTransaction · ORDER-2002',
  routedEvent('producer', 'local-db', 'BEGIN · ORDER-2002', 'tx2', 'database'),
  '失败时不要提交消息',
  rollbackRule,
)

updateLocal('tx2', 'rolled-back')
addFrame(
  'tx2-local-rolled-back',
  '本地回滚',
  '本地数据库回滚 ORDER-2002',
  '订单没有变成已支付，因此对应事件也不能对下游可见。',
  'DB ROLLBACK · ORDER-2002',
  routedEvent('local-db', 'producer', 'Local Rollback · TX2', 'tx2', 'database'),
  '本地结果决定 Rollback',
  rollbackRule,
)

producer.status = 'resolved'
addFrame(
  'tx2-rollback-sent',
  '本地回滚',
  'Producer 发送 TX2 第二阶段 Rollback',
  'Broker 收到明确的回滚结果，不再等待事务回查。',
  'transaction.rollback · TX2',
  routedEvent('producer', 'broker', 'Rollback · TX2', 'tx2', 'rollback'),
  'Rollback 终止消息生命周期',
  rollbackRule,
)

removeHalf('tx2')
broker.rolledBack.push('tx2')
addFrame(
  'tx2-discarded',
  '本地回滚',
  'Broker 终止 TX2，不向 Consumer 投递',
  'TX2 从 Half 区域移除并记录为 rolled back；Ready 队列保持为空。',
  'TX2 · rolled back',
  { route: null, label: 'TX2 不可投递', messageId: 'tx2', kind: 'rollback' },
  'Rollback 分支没有下游事件',
  rollbackRule,
)

producer.status = 'sending-half'
producer.current = checkedMessage
addFrame(
  'tx3-half-sent',
  '事务回查',
  'Producer 发送 TX3 Half Message',
  'ORDER-2003 将演示本地事务成功但第二阶段 Commit 丢失的异常。',
  'send half · TX3',
  routedEvent('producer', 'broker', 'Half Message · TX3', 'tx3', 'half'),
  '异常分支仍从 Half 开始',
  halfRule,
)

broker.halfMessages.push({ message: checkedMessage, state: 'pending', checkCount: 0 })
addFrame(
  'tx3-half-acked',
  '事务回查',
  'Broker 保存 TX3 并返回 Half Ack',
  'TX3 处于 pending，在最终状态确定前不会投递。',
  'half ack · TX3 pending',
  routedEvent('broker', 'producer', 'Half Ack · TX3', 'tx3', 'half-ack'),
  'Pending 允许最终状态恢复',
  halfRule,
)

producer.status = 'executing-local'
producer.localTransactions.push({ messageId: 'tx3', orderId: 'ORDER-2003', state: 'pending' })
addFrame(
  'tx3-local-started',
  '事务回查',
  'Producer 执行 ORDER-2003 本地事务',
  '订单服务正常更新数据库，但稍后网络会丢失第二阶段结果。',
  'executeLocalTransaction · ORDER-2003',
  routedEvent('producer', 'local-db', 'BEGIN · ORDER-2003', 'tx3', 'database'),
  '本地记录是回查依据',
  checkRule,
)

updateLocal('tx3', 'committed')
addFrame(
  'tx3-local-committed',
  '事务回查',
  '本地数据库提交 ORDER-2003',
  '本地事实已经确定为 committed，但 Broker 仍只知道 TX3 是 pending。',
  'DB COMMIT · ORDER-2003=PAID',
  routedEvent('local-db', 'producer', 'Local Commit · TX3', 'tx3', 'database'),
  'Checker 查询持久化事实',
  checkRule,
)

producer.status = 'idle'
addFrame(
  'tx3-second-ack-lost',
  '事务回查',
  'TX3 的第二阶段 Commit 因网络故障丢失',
  'Broker 没有收到 Commit 或 Rollback，不能猜测本地事务结果，TX3 继续保持不可见。',
  'commit response lost · state=UNKNOWN',
  routedEvent('producer', 'broker', 'Commit 丢失 · TX3', 'tx3', 'fault'),
  'Unknown 不能直接提交或回滚',
  checkRule,
)

broker.halfMessages = broker.halfMessages.map((half) =>
  half.message.id === 'tx3' ? { ...half, checkCount: 1 } : half,
)
producer.status = 'checking'
addFrame(
  'tx3-check-requested',
  '事务回查',
  'Broker 超时后发起 TX3 事务状态回查',
  'Broker 请求同一 Producer 集群中的可用实例查询 ORDER-2003 的本地事务结果。',
  'transaction check · attempt=1',
  routedEvent('broker', 'producer', 'Check · TX3', 'tx3', 'check'),
  'Transaction Checker 保障最终一致',
  checkRule,
)

addFrame(
  'tx3-local-checked',
  '事务回查',
  'Transaction Checker 查询本地事务表',
  'Checker 通过 ORDER-2003 找到 committed 记录，因此应返回 Commit，而不是凭内存猜测。',
  'SELECT state WHERE order_id=ORDER-2003',
  routedEvent('producer', 'local-db', 'Query Local Transaction · TX3', 'tx3', 'database'),
  '回查必须可重复且可靠',
  '事务状态应持久化并能通过业务唯一键查询；进程内临时变量无法承受重启和实例切换。',
)

producer.status = 'resolved'
addFrame(
  'tx3-check-committed',
  '事务回查',
  'Checker 向 Broker 返回 Commit',
  '回查补偿了丢失的第二阶段确认，Broker 获得 TX3 的最终状态。',
  'TransactionResolution.COMMIT · TX3',
  routedEvent('producer', 'broker', 'Check Result · Commit TX3', 'tx3', 'commit'),
  '回查收敛到最终状态',
  checkRule,
)

removeHalf('tx3')
broker.ready.push(checkedMessage)
addFrame(
  'tx3-ready',
  '事务回查',
  'Broker 将 TX3 标记为 Ready',
  'TX3 结束 pending 状态并对 Consumer 可见，本地事务与消息发布最终一致。',
  'pending → ready · TX3',
  { route: null, label: 'TX3 对 Consumer 可见', messageId: 'tx3', kind: 'commit' },
  '最终一致不等于实时一致',
  '从本地事务提交到回查完成存在时间窗口，因此事务消息适合能接受异步下游处理的场景。',
)

broker.ready.shift()
consumer.status = 'processing'
consumer.current = checkedMessage
addFrame(
  'tx3-delivered',
  '流程完成',
  'Consumer 最终收到 TX3',
  'ORDER-2003 的下游事件在回查收敛后成功投递；TX2 始终不会出现。',
  'deliver · ORDER-2003',
  routedEvent('broker', 'consumer', 'Deliver · TX3', 'tx3', 'deliver'),
  '三条分支得到确定结果',
  'TX1 正常 Commit，TX2 Rollback，TX3 通过事务回查 Commit；Consumer 只看到 TX1 与 TX3。',
)

consumer.status = 'waiting'
consumer.current = null
consumer.consumed.push('tx3')

export const rocketFrames = deepFreeze(frames)
