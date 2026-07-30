<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'
import { Activity, ArrowDown, Inbox, Layers3, Rabbit, Send, UserCheck } from '@lucide/vue'
import PlayerControls from './PlayerControls.vue'
import { useStepPlayer } from '../composables/useStepPlayer'
import { rabbitExchange, rabbitFrames, type RabbitNodeId } from '../simulations/rabbit'

const total = computed(() => rabbitFrames.length)
const player = useStepPlayer(total)
const frame = computed(() => rabbitFrames[player.step.value])
const stepLabels = rabbitFrames.map(({ title }) => title)
const topology = ref<HTMLDivElement | null>(null)
const eventPathElement = ref<SVGPathElement | null>(null)
const messageDot = ref<SVGGElement | null>(null)
const eventPath = ref('')
const topologySize = ref({ width: 1, height: 1 })

const currentMessage = computed(() => frame.value.publisher.current)
const confirmCount = computed(() => frame.value.publisher.confirms.filter(({ outcome }) => outcome === 'ack').length)
const returnCount = computed(() => frame.value.publisher.returns.length)

const nodeLabels: Record<RabbitNodeId, string> = {
  publisher: 'Publisher',
  exchange: 'orders.x',
  'orders-queue': 'orders.q',
  consumer: 'Consumer',
}

function isRouteNode(nodeId: RabbitNodeId) {
  const route = frame.value.event.route
  return route?.from === nodeId || route?.to === nodeId
}

function publisherStatusLabel() {
  return frame.value.publisher.status.toUpperCase()
}

function consumerStatusLabel() {
  return frame.value.consumer.status.toUpperCase()
}

interface Point {
  x: number
  y: number
}

interface LocalRect extends Point {
  width: number
  height: number
}

function center(rect: LocalRect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function edgePoint(rect: LocalRect, target: Point): Point {
  const origin = center(rect)
  const dx = target.x - origin.x
  const dy = target.y - origin.y
  if (dx === 0 && dy === 0) return origin
  const scale = 1 / Math.max(
    Math.abs(dx) / Math.max(rect.width / 2, 1),
    Math.abs(dy) / Math.max(rect.height / 2, 1),
  )
  return { x: origin.x + dx * scale, y: origin.y + dy * scale }
}

function localRect(element: Element, containerRect: DOMRect): LocalRect {
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left - containerRect.left,
    y: rect.top - containerRect.top,
    width: rect.width,
    height: rect.height,
  }
}

function syncEventPath() {
  const container = topology.value
  const route = frame.value.event.route
  if (!container || !route) {
    eventPath.value = ''
    return
  }

  const fromElement = container.querySelector(`[data-route-id="${route.from}"]`)
  const toElement = container.querySelector(`[data-route-id="${route.to}"]`)
  if (!fromElement || !toElement) {
    eventPath.value = ''
    return
  }

  const containerRect = container.getBoundingClientRect()
  topologySize.value = { width: containerRect.width, height: containerRect.height }
  const fromRect = localRect(fromElement, containerRect)
  const toRect = localRect(toElement, containerRect)
  const fromCenter = center(fromRect)
  const toCenter = center(toRect)
  const start = edgePoint(fromRect, toCenter)
  const end = edgePoint(toRect, fromCenter)
  const dx = end.x - start.x
  const dy = end.y - start.y

  if (Math.abs(dy) < 44) {
    const lift = Math.max(18, Math.min(36, Math.abs(dx) * 0.14))
    eventPath.value = `M${start.x} ${start.y} Q${(start.x + end.x) / 2} ${start.y - lift} ${end.x} ${end.y}`
    return
  }

  const middleX = start.x + dx / 2
  eventPath.value = `M${start.x} ${start.y} C${middleX} ${start.y} ${middleX} ${end.y} ${end.x} ${end.y}`
}

let activeMessageTween: gsap.core.Tween | null = null
let topologyResizeObserver: ResizeObserver | null = null

async function animateEvent() {
  await nextTick()
  syncEventPath()
  await nextTick()
  activeMessageTween?.kill()
  activeMessageTween = null

  const path = eventPathElement.value
  if (!path || !messageDot.value) return
  const length = path.getTotalLength()
  const motion = { progress: 0 }
  const start = path.getPointAtLength(0)
  gsap.set(messageDot.value, { x: start.x, y: start.y })
  activeMessageTween = gsap.to(motion, {
    progress: 1,
    duration: 0.9,
    ease: 'power2.inOut',
    onUpdate: () => {
      if (!messageDot.value) return
      const point = path.getPointAtLength(length * motion.progress)
      gsap.set(messageDot.value, { x: point.x, y: point.y })
    },
  })
}

watch(player.step, animateEvent)
onMounted(() => {
  animateEvent()
  if (!topology.value) return
  topologyResizeObserver = new ResizeObserver(syncEventPath)
  topologyResizeObserver.observe(topology.value)
})
onBeforeUnmount(() => {
  activeMessageTween?.kill()
  topologyResizeObserver?.disconnect()
})
</script>

<template>
  <section class="lab" aria-labelledby="rabbit-title">
    <header class="lab-heading lab-heading--redis">
      <div>
        <div class="eyebrow eyebrow--rabbit"><Rabbit :size="15" /> RabbitMQ · orders</div>
        <h1 id="rabbit-title">发布确认、消息退回与消费确认</h1>
        <p>区分 Publisher Confirm、mandatory Return 与 Consumer Ack 三种不同的可靠性信号。</p>
      </div>
      <div class="scenario-chip">
        <span class="scenario-chip__dot scenario-chip__dot--rabbit" />
        Direct Exchange · Confirm · Return · Manual Ack
      </div>
    </header>

    <div class="lab-meta lab-meta--redis" aria-label="当前 RabbitMQ 状态">
      <span><strong>{{ frame.phase }}</strong><small>当前阶段</small></span>
      <span><strong>{{ confirmCount }} Ack · {{ returnCount }} Return</strong><small>发布端回执</small></span>
      <span><strong>{{ frame.queue.ready.length }} Ready · {{ frame.queue.unacked.length }} Unacked</strong><small>orders.q</small></span>
    </div>

    <div class="lab-layout lab-layout--redis">
      <div class="stage-panel stage-panel--redis">
        <div class="stage-heading stage-heading--redis">
          <div>
            <span class="step-index step-index--rabbit">{{ String(player.step.value + 1).padStart(2, '0') }}</span>
            <div>
              <h2>{{ frame.title }}</h2>
              <p>{{ frame.description }}</p>
            </div>
          </div>
          <code>{{ frame.context }}</code>
        </div>

        <div class="diagram-wrap rabbit-topology-wrap">
          <div
            ref="topology"
            class="rabbit-topology"
            role="img"
            :aria-label="`${frame.phase}：${frame.title}`"
          >
            <svg
              class="rabbit-event-layer"
              :viewBox="`0 0 ${topologySize.width} ${topologySize.height}`"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <marker id="rabbit-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0 0 L8 4 L0 8 Z" class="rabbit-arrow-head" />
                </marker>
              </defs>
              <path
                v-if="eventPath"
                ref="eventPathElement"
                :d="eventPath"
                class="rabbit-event-path"
                :class="`kind-${frame.event.kind}`"
                marker-end="url(#rabbit-arrow)"
              />
              <g
                v-if="eventPath"
                ref="messageDot"
                class="rabbit-message-dot"
                :class="`kind-${frame.event.kind}`"
              >
                <circle r="9" class="rabbit-message-dot__ring" />
                <circle r="4" />
              </g>
            </svg>

            <article
              class="rabbit-publisher rabbit-node"
              :class="{ 'is-active': isRouteNode('publisher') }"
              data-route-id="publisher"
            >
              <header><Send :size="15" /><strong>Publisher</strong><small>{{ publisherStatusLabel() }}</small></header>
              <div class="rabbit-flags">
                <span :class="{ 'is-on': frame.publisher.confirmMode }">confirm.select</span>
                <span :class="{ 'is-on': frame.publisher.mandatory }">mandatory</span>
              </div>
              <div class="rabbit-current-message">
                <small>当前发布</small>
                <strong v-if="currentMessage">{{ currentMessage.id.toUpperCase() }}</strong>
                <span v-if="currentMessage">{{ currentMessage.routingKey }}</span>
                <strong v-else>—</strong>
              </div>
              <footer>
                <span>Confirm {{ confirmCount }}</span>
                <span :class="{ 'has-return': returnCount }">Return {{ returnCount }}</span>
              </footer>
            </article>

            <section class="rabbit-broker" aria-label="RabbitMQ Broker">
              <div
                class="rabbit-exchange rabbit-node"
                :class="{ 'is-active': isRouteNode('exchange') }"
                data-route-id="exchange"
              >
                <header><Rabbit :size="14" /><strong>{{ rabbitExchange.name }}</strong><small>DIRECT</small></header>
                <code>routing key</code>
                <span>{{ rabbitExchange.bindingKey }}</span>
              </div>
              <div class="rabbit-binding"><ArrowDown :size="14" /><code>{{ rabbitExchange.bindingKey }}</code></div>
              <div
                class="rabbit-queue rabbit-node"
                :class="{ 'is-active': isRouteNode('orders-queue') }"
                data-route-id="orders-queue"
              >
                <header><Inbox :size="14" /><strong>orders.q</strong><small>DURABLE</small></header>
                <div class="rabbit-queue-counts">
                  <span><strong>{{ frame.queue.ready.length }}</strong><small>READY</small></span>
                  <span><strong>{{ frame.queue.unacked.length }}</strong><small>UNACKED</small></span>
                </div>
                <div class="rabbit-message-pills">
                  <span
                    v-for="item in frame.queue.ready"
                    :key="`ready-${item.id}`"
                    :class="{ 'is-redelivered': item.redelivered }"
                  >{{ item.id.toUpperCase() }} · ready</span>
                  <span
                    v-for="delivery in frame.queue.unacked"
                    :key="`unacked-${delivery.message.id}`"
                    class="is-unacked"
                  >{{ delivery.message.id.toUpperCase() }} · tag {{ delivery.deliveryTag }}</span>
                  <small v-if="!frame.queue.ready.length && !frame.queue.unacked.length">队列为空</small>
                </div>
              </div>
            </section>

            <article
              class="rabbit-consumer rabbit-node"
              :class="{ 'is-active': isRouteNode('consumer'), 'is-failed': frame.consumer.status === 'failed' || frame.consumer.status === 'closed' }"
              data-route-id="consumer"
            >
              <header><UserCheck :size="15" /><strong>Consumer</strong><small>{{ consumerStatusLabel() }}</small></header>
              <div class="rabbit-flags">
                <span class="is-on">manual ack</span>
                <span class="is-on">prefetch={{ frame.consumer.prefetch }}</span>
              </div>
              <div class="rabbit-current-message">
                <small>Channel {{ frame.consumer.channel }}</small>
                <strong v-if="frame.consumer.current">{{ frame.consumer.current.message.id.toUpperCase() }}</strong>
                <span v-if="frame.consumer.current">
                  tag {{ frame.consumer.current.deliveryTag }}
                  <template v-if="frame.consumer.current.message.redelivered"> · redelivered</template>
                </span>
                <strong v-else>等待投递</strong>
              </div>
              <footer><span>Handled</span><code>{{ frame.consumer.handled.join(', ').toUpperCase() || '—' }}</code></footer>
            </article>
          </div>
        </div>

        <PlayerControls
          :step="player.step.value"
          :total="total"
          :playing="player.playing.value"
          :speed="player.speed.value"
          :step-labels="stepLabels"
          @previous="player.previous"
          @next="player.next"
          @toggle="player.toggle"
          @reset="player.reset"
          @go-to="player.goTo"
          @update:speed="player.speed.value = $event"
        />
      </div>

      <aside class="inspector-panel inspector-panel--redis rabbit-inspector" aria-label="RabbitMQ 状态检查器">
        <div class="inspector-heading">
          <span><Activity :size="16" /> RabbitMQ 状态 · orders</span>
          <span class="status-badge is-live">CH {{ frame.consumer.channel }}</span>
        </div>

        <div class="inspector-section-label rabbit-inspector__first-label">发布端回执</div>
        <div class="rabbit-receipts">
          <section>
            <header><strong>Publisher Confirm</strong><span>{{ confirmCount }}</span></header>
            <div v-if="frame.publisher.confirms.length">
              <code v-for="receipt in frame.publisher.confirms" :key="receipt.messageId">
                {{ receipt.messageId.toUpperCase() }} · {{ receipt.outcome.toUpperCase() }}
              </code>
            </div>
            <small v-else>等待 Broker 确认</small>
          </section>
          <section :class="{ 'has-return': frame.publisher.returns.length }">
            <header><strong>mandatory Return</strong><span>{{ returnCount }}</span></header>
            <div v-if="frame.publisher.returns.length">
              <code v-for="receipt in frame.publisher.returns" :key="receipt.messageId">
                {{ receipt.messageId.toUpperCase() }} · {{ receipt.replyCode }} {{ receipt.replyText }}
              </code>
            </div>
            <small v-else>暂无不可路由消息</small>
          </section>
        </div>

        <div class="inspector-section-label">消费端状态</div>
        <div class="rabbit-consumer-state">
          <div><span>模式</span><strong>manual ack</strong></div>
          <div><span>窗口</span><strong>prefetch {{ frame.consumer.prefetch }}</strong></div>
          <div><span>Channel</span><strong>{{ frame.consumer.channel }}</strong></div>
          <div><span>状态</span><strong>{{ consumerStatusLabel() }}</strong></div>
        </div>

        <div class="event-message" :class="`kind-${frame.event.kind}`">
          <span class="event-pulse" />
          <div>
            <small>当前事件</small>
            <strong v-if="frame.event.route">
              {{ nodeLabels[frame.event.route.from] }} → {{ nodeLabels[frame.event.route.to] }}
            </strong>
            <strong v-else>本地状态变化</strong>
            <code>{{ frame.event.label }}</code>
          </div>
        </div>

        <div class="protocol-note">
          <Layers3 :size="18" />
          <p><strong>{{ frame.ruleTitle }}</strong><span>{{ frame.rule }}</span></p>
        </div>
      </aside>
    </div>
  </section>
</template>
