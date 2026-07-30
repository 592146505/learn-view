export type RabbitMessageId = 'm1' | 'm2' | 'm3'
export type RabbitNodeId = 'publisher' | 'exchange' | 'orders-queue' | 'consumer'
export type RabbitPublisherStatus = 'idle' | 'publishing' | 'confirmed' | 'returned'
export type RabbitConsumerStatus = 'idle' | 'waiting' | 'processing' | 'failed' | 'closed'
export type RabbitEventKind = 'local' | 'publish' | 'route' | 'confirm' | 'return' | 'deliver' | 'ack' | 'nack' | 'fault'

export interface RabbitMessage {
  readonly id: RabbitMessageId
  readonly routingKey: string
  readonly body: string
  readonly persistent: boolean
  readonly redelivered: boolean
}

export interface RabbitConfirm {
  readonly messageId: RabbitMessageId
  readonly outcome: 'ack' | 'nack'
}

export interface RabbitReturn {
  readonly messageId: RabbitMessageId
  readonly replyCode: 312
  readonly replyText: 'NO_ROUTE'
}

export interface RabbitDelivery {
  readonly message: RabbitMessage
  readonly deliveryTag: number
  readonly channel: number
}

export interface RabbitPublisherState {
  readonly confirmMode: boolean
  readonly mandatory: boolean
  readonly status: RabbitPublisherStatus
  readonly current: RabbitMessage | null
  readonly confirms: readonly RabbitConfirm[]
  readonly returns: readonly RabbitReturn[]
}

export interface RabbitQueueState {
  readonly name: 'orders.q'
  readonly durable: true
  readonly ready: readonly RabbitMessage[]
  readonly unacked: readonly RabbitDelivery[]
}

export interface RabbitConsumerState {
  readonly status: RabbitConsumerStatus
  readonly channel: number
  readonly prefetch: 1
  readonly manualAck: true
  readonly current: RabbitDelivery | null
  readonly handled: readonly RabbitMessageId[]
}

export interface RabbitEvent {
  readonly kind: RabbitEventKind
  readonly route: { readonly from: RabbitNodeId; readonly to: RabbitNodeId } | null
  readonly label: string
  readonly messageId: RabbitMessageId | null
}

export interface RabbitFrame {
  readonly id: string
  readonly phase: string
  readonly title: string
  readonly description: string
  readonly context: string
  readonly publisher: RabbitPublisherState
  readonly queue: RabbitQueueState
  readonly consumer: RabbitConsumerState
  readonly event: RabbitEvent
  readonly ruleTitle: string
  readonly rule: string
}

interface MutablePublisherState {
  confirmMode: boolean
  mandatory: boolean
  status: RabbitPublisherStatus
  current: RabbitMessage | null
  confirms: RabbitConfirm[]
  returns: RabbitReturn[]
}

interface MutableQueueState {
  name: 'orders.q'
  durable: true
  ready: RabbitMessage[]
  unacked: RabbitDelivery[]
}

interface MutableConsumerState {
  status: RabbitConsumerStatus
  channel: number
  prefetch: 1
  manualAck: true
  current: RabbitDelivery | null
  handled: RabbitMessageId[]
}

const confirmRule = 'Publisher Confirm 只说明 Broker 接管了发布；它不是消费者处理成功的证明。'
const returnRule = 'mandatory=true 且消息无法路由时，Broker 先发送 basic.return；该消息仍可能收到 publisher confirm ack。'
const ackRule = 'manual ack 在消费通道内确认 delivery tag；只有 basic.ack 后，Broker 才会从 unacked 移除消息。'
const requeueRule = 'basic.nack(requeue=true) 或通道关闭会把未确认消息重新入队，后续投递携带 redelivered=true。'

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

function message(
  id: RabbitMessageId,
  routingKey: string,
  body: string,
  redelivered = false,
): RabbitMessage {
  return { id, routingKey, body, persistent: true, redelivered }
}

const publisher: MutablePublisherState = {
  confirmMode: false,
  mandatory: false,
  status: 'idle',
  current: null,
  confirms: [],
  returns: [],
}

const queue: MutableQueueState = {
  name: 'orders.q',
  durable: true,
  ready: [],
  unacked: [],
}

const consumer: MutableConsumerState = {
  status: 'idle',
  channel: 1,
  prefetch: 1,
  manualAck: true,
  current: null,
  handled: [],
}

const frames: RabbitFrame[] = []

function addFrame(
  id: string,
  phase: string,
  title: string,
  description: string,
  context: string,
  event: RabbitEvent,
  ruleTitle: string,
  rule: string,
) {
  frames.push({
    id,
    phase,
    title,
    description,
    context,
    publisher: clone(publisher),
    queue: clone(queue),
    consumer: clone(consumer),
    event,
    ruleTitle,
    rule,
  })
}

function route(
  from: RabbitNodeId,
  to: RabbitNodeId,
  label: string,
  messageId: RabbitMessageId,
  kind: RabbitEventKind,
): RabbitEvent {
  return { route: { from, to }, label, messageId, kind }
}

const routed = message('m1', 'order.created', '{"orderId":1001}')
const unroutable = message('m2', 'order.unknown', '{"orderId":1002}')
const channelFailure = message('m3', 'order.created', '{"orderId":1003}')

addFrame(
  'topology-ready',
  '拓扑准备',
  '声明 Direct Exchange、Queue 与 Binding',
  'orders.x 通过 routing key = order.created 绑定 durable 队列 orders.q。',
  'exchange.declare · queue.declare · queue.bind',
  { route: null, label: 'orders.x —[order.created]→ orders.q', messageId: null, kind: 'local' },
  '可靠性分成发布与消费两段',
  'Confirm/Return 约束 Publisher 到 Broker；Consumer Ack 约束 Broker 到 Consumer，两段不能互相替代。',
)

publisher.confirmMode = true
publisher.mandatory = true
addFrame(
  'publisher-reliability-enabled',
  '发布确认',
  'Publisher 开启 Confirm 与 mandatory',
  'confirm.select 开启异步发布确认；mandatory=true 让不可路由消息返回 Publisher。',
  'confirm.select · mandatory=true',
  { route: null, label: 'Publisher 监听 ack/nack 与 basic.return', messageId: null, kind: 'local' },
  'Confirm 与 Return 是独立信号',
  '应用必须同时注册 ConfirmCallback 和 ReturnsCallback，不能用其中一个推断另一个。',
)

publisher.status = 'publishing'
publisher.current = routed
addFrame(
  'm1-published',
  '可路由发布',
  'Publisher 将 M1 发往 orders.x',
  'routing key order.created 能命中 orders.q 的 binding。',
  'basic.publish mandatory=true · order.created',
  route('publisher', 'exchange', 'M1 → orders.x', 'm1', 'publish'),
  '先进入 Exchange 再路由',
  'Publisher 不直接写 Queue；Exchange 根据类型、binding 与 routing key 决定目标。',
)

queue.ready.push(routed)
addFrame(
  'm1-routed',
  '可路由发布',
  'Exchange 将 M1 路由并写入 orders.q',
  '消息进入 ready，等待 Consumer 获取；持久化仍依赖 durable queue 与 persistent message 的组合。',
  'orders.x → orders.q · ready=1',
  route('exchange', 'orders-queue', 'M1 入队', 'm1', 'route'),
  '路由成功不等于消费成功',
  '此时 Broker 已接管消息，但 Consumer 尚未收到，更谈不上业务处理完成。',
)

publisher.status = 'confirmed'
publisher.confirms.push({ messageId: 'm1', outcome: 'ack' })
addFrame(
  'm1-confirmed',
  '可路由发布',
  'Broker 向 Publisher 返回 Confirm Ack',
  'M1 的发布序号被 ack，Publisher 可以结束本次重试计时。',
  'basic.ack · M1 confirmed',
  route('exchange', 'publisher', 'Confirm Ack · M1', 'm1', 'confirm'),
  'Confirm Ack 的边界',
  confirmRule,
)

publisher.status = 'publishing'
publisher.current = unroutable
addFrame(
  'm2-published',
  '不可路由发布',
  'Publisher 发布 routing key 不匹配的 M2',
  'order.unknown 无法命中 orders.q，mandatory=true 阻止 Broker 静默丢弃。',
  'basic.publish mandatory=true · order.unknown',
  route('publisher', 'exchange', 'M2 → orders.x', 'm2', 'publish'),
  'mandatory 只处理不可路由',
  'mandatory 不保证消费，也不表示消息一定持久化；它只要求无法路由时把消息退回。',
)

publisher.status = 'returned'
publisher.returns.push({ messageId: 'm2', replyCode: 312, replyText: 'NO_ROUTE' })
addFrame(
  'm2-returned',
  '不可路由发布',
  'Broker 通过 basic.return 退回 M2',
  'Return 携带 replyCode=312、NO_ROUTE、原 routing key 与消息体；M2 没有进入任何 Queue。',
  'basic.return 312 NO_ROUTE · M2',
  route('exchange', 'publisher', 'Return · M2 · NO_ROUTE', 'm2', 'return'),
  'Return 必须单独处理',
  returnRule,
)

publisher.status = 'confirmed'
publisher.confirms.push({ messageId: 'm2', outcome: 'ack' })
addFrame(
  'm2-confirmed',
  '不可路由发布',
  'M2 被 Return 后仍收到 Confirm Ack',
  'Ack 表示 Exchange 已处理该发布，不表示路由成功；应用应以 Return 判定 M2 需要补偿。',
  'basic.return → basic.ack',
  route('exchange', 'publisher', 'Confirm Ack · M2', 'm2', 'confirm'),
  'Ack 与 Return 可以同时出现',
  returnRule,
)

consumer.status = 'waiting'
addFrame(
  'consumer-subscribed',
  '手动确认',
  'Consumer 以 manual ack、prefetch=1 订阅',
  'Broker 同一时间最多给该 Consumer 一个未确认消息，形成基本背压。',
  'basic.qos prefetch=1 · autoAck=false',
  route('consumer', 'orders-queue', 'basic.consume · orders.q', 'm1', 'deliver'),
  'prefetch 限制未确认窗口',
  'prefetch=1 不是每次只消费一条，而是该通道最多保留一条尚未 ack 的投递。',
)

queue.ready.shift()
const m1Delivery: RabbitDelivery = { message: routed, deliveryTag: 1, channel: 1 }
queue.unacked.push(m1Delivery)
consumer.status = 'processing'
consumer.current = m1Delivery
addFrame(
  'm1-delivered',
  '手动确认',
  'Broker 投递 M1，消息进入 unacked',
  'deliveryTag=1 只在 Channel 1 内有效；Consumer 完成业务前不能提前 ack。',
  'basic.deliver tag=1 · redelivered=false',
  route('orders-queue', 'consumer', 'Deliver · M1 · tag 1', 'm1', 'deliver'),
  '投递不等于完成',
  ackRule,
)

consumer.status = 'failed'
addFrame(
  'm1-processing-failed',
  '失败重投',
  'Consumer 处理 M1 时发生可重试错误',
  '消息仍在 unacked；Broker 不会仅凭业务异常自动决定 ack、requeue 或死信。',
  'handler throws RetryableException',
  { route: null, label: 'M1 仍为 unacked', messageId: 'm1', kind: 'fault' },
  '失败策略由 Consumer 明确选择',
  '应用必须根据错误类型选择 ack、nack requeue、nack dead-letter 或关闭通道。',
)

queue.unacked.shift()
queue.ready.unshift(message('m1', routed.routingKey, routed.body, true))
consumer.status = 'waiting'
consumer.current = null
addFrame(
  'm1-nacked-requeue',
  '失败重投',
  'Consumer 对 M1 执行 Nack 并重新入队',
  'basic.nack(tag=1, requeue=true) 将消息从 unacked 放回 ready。',
  'basic.nack tag=1 · multiple=false · requeue=true',
  route('consumer', 'orders-queue', 'Nack · M1 · requeue', 'm1', 'nack'),
  '避免无限重试',
  '真实系统应限制重试次数，并用 DLX/延迟队列处理持续失败，避免 requeue 热循环。',
)

const redeliveredM1 = queue.ready.shift()!
const m1Redelivery: RabbitDelivery = { message: redeliveredM1, deliveryTag: 2, channel: 1 }
queue.unacked.push(m1Redelivery)
consumer.status = 'processing'
consumer.current = m1Redelivery
addFrame(
  'm1-redelivered',
  '失败重投',
  'Broker 再次投递 M1',
  'redelivered=true 提示这不是首次投递；Consumer 仍需依靠幂等键防止重复副作用。',
  'basic.deliver tag=2 · redelivered=true',
  route('orders-queue', 'consumer', 'Redeliver · M1 · tag 2', 'm1', 'deliver'),
  '至少一次需要幂等',
  'redelivered 标记只是提示，无法证明消息一定重复；业务应以 messageId 或业务唯一键去重。',
)

queue.unacked.shift()
consumer.status = 'waiting'
consumer.current = null
consumer.handled.push('m1')
addFrame(
  'm1-acked',
  '确认完成',
  '业务提交后 Consumer Ack M1',
  'basic.ack(tag=2, multiple=false) 让 Broker 从 unacked 删除该投递。',
  'transaction.commit → basic.ack tag=2',
  route('consumer', 'orders-queue', 'Ack · M1 · tag 2', 'm1', 'ack'),
  'Ack 应晚于业务提交',
  ackRule,
)

publisher.status = 'publishing'
publisher.current = channelFailure
addFrame(
  'm3-published',
  '通道故障',
  'Publisher 发布可路由消息 M3',
  'M3 用于演示 Consumer 在 ack 前断开时 Broker 的自动重入队。',
  'basic.publish · order.created · M3',
  route('publisher', 'exchange', 'M3 → orders.x', 'm3', 'publish'),
  '发布确认与消费确认继续独立',
  confirmRule,
)

queue.ready.push(channelFailure)
addFrame(
  'm3-routed',
  '通道故障',
  'M3 被路由到 orders.q',
  'M3 进入 ready，随后可在 prefetch 窗口允许时投递。',
  'orders.x → orders.q · ready=1',
  route('exchange', 'orders-queue', 'M3 入队', 'm3', 'route'),
  'Queue 保存待投递状态',
  'ready 表示等待投递，unacked 表示已投递但尚未得到 Consumer 确认。',
)

publisher.status = 'confirmed'
publisher.confirms.push({ messageId: 'm3', outcome: 'ack' })
addFrame(
  'm3-confirmed',
  '通道故障',
  'Publisher 收到 M3 的 Confirm Ack',
  '发布端至此完成，但 M3 的消费生命周期才刚开始。',
  'basic.ack · M3 confirmed',
  route('exchange', 'publisher', 'Confirm Ack · M3', 'm3', 'confirm'),
  '不要混用两种 Ack',
  'Publisher Confirm Ack 与 Consumer basic.ack 名字相似，但方向、通道和可靠性边界完全不同。',
)

queue.ready.shift()
const m3Delivery: RabbitDelivery = { message: channelFailure, deliveryTag: 3, channel: 1 }
queue.unacked.push(m3Delivery)
consumer.status = 'processing'
consumer.current = m3Delivery
addFrame(
  'm3-delivered',
  '通道故障',
  'Broker 在 Channel 1 投递 M3',
  'M3 进入 unacked，等待 deliveryTag=3 的确认。',
  'basic.deliver channel=1 · tag=3',
  route('orders-queue', 'consumer', 'Deliver · M3 · tag 3', 'm3', 'deliver'),
  'Delivery Tag 归属于 Channel',
  'delivery tag 只能在产生它的同一 Channel 上 ack；跨 Channel 使用会触发协议错误。',
)

queue.unacked.shift()
queue.ready.unshift(message('m3', channelFailure.routingKey, channelFailure.body, true))
consumer.status = 'closed'
consumer.current = null
addFrame(
  'consumer-channel-closed',
  '通道故障',
  'Consumer 在 Ack 前断开 Channel 1',
  'Broker 检测到通道关闭，把 Channel 1 上未确认的 M3 自动重新入队。',
  'channel 1 closed · unacked → ready',
  route('consumer', 'orders-queue', 'Channel closed · requeue M3', 'm3', 'fault'),
  '断开会回收未确认投递',
  requeueRule,
)

consumer.channel = 2
consumer.status = 'waiting'
addFrame(
  'consumer-reconnected',
  '通道恢复',
  'Consumer 使用新的 Channel 2 恢复订阅',
  '新的 Channel 拥有独立的 delivery tag 序列，不能沿用 Channel 1 的 tag=3。',
  'channel 2 · basic.consume',
  route('consumer', 'orders-queue', 'Reconnect · Channel 2', 'm3', 'deliver'),
  'Delivery Tag 按 Channel 计数',
  '重连后应使用新投递携带的 delivery tag，而不是缓存旧 Channel 的 tag。',
)

const redeliveredM3 = queue.ready.shift()!
const m3Redelivery: RabbitDelivery = { message: redeliveredM3, deliveryTag: 1, channel: 2 }
queue.unacked.push(m3Redelivery)
consumer.status = 'processing'
consumer.current = m3Redelivery
addFrame(
  'm3-redelivered',
  '通道恢复',
  'M3 在 Channel 2 上重新投递',
  '新的 deliveryTag 从 1 开始，redelivered=true；消息内容与业务幂等键保持不变。',
  'basic.deliver channel=2 · tag=1 · redelivered=true',
  route('orders-queue', 'consumer', 'Redeliver · M3 · ch2/tag1', 'm3', 'deliver'),
  '通道恢复不提供恰好一次',
  requeueRule,
)

queue.unacked.shift()
consumer.status = 'waiting'
consumer.current = null
consumer.handled.push('m3')
addFrame(
  'm3-acked',
  '流程完成',
  'Consumer 在 Channel 2 Ack M3',
  'Broker 删除最后一条 unacked；M1 与 M3 均完成，M2 则由 Return 补偿。',
  'basic.ack channel=2 · tag=1',
  route('consumer', 'orders-queue', 'Ack · M3 · ch2/tag1', 'm3', 'ack'),
  '端到端可靠性需要两套确认',
  'Publisher 处理 Confirm/Return，Consumer 在业务提交后 Ack，并以幂等和重试策略承接重复投递。',
)

export const rabbitExchange = deepFreeze({
  name: 'orders.x' as const,
  type: 'direct' as const,
  bindingKey: 'order.created' as const,
})

export const rabbitFrames = deepFreeze(frames)
