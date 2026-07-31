<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'
import { Activity, Database, Layers3, Rocket, Server, UserCheck } from '@lucide/vue'
import PlayerControls from './PlayerControls.vue'
import { useStepPlayer } from '../composables/useStepPlayer'
import {
  rocketFrames,
  type RocketMessageId,
  type RocketNodeId,
  type RocketTransactionState,
} from '../simulations/rocketmq'

const total = computed(() => rocketFrames.length)
const player = useStepPlayer(total)
const frame = computed(() => rocketFrames[player.step.value])
const stepLabels = rocketFrames.map(({ title }) => title)
const topology = ref<HTMLDivElement | null>(null)
const eventPathElement = ref<SVGPathElement | null>(null)
const messageDot = ref<SVGGElement | null>(null)
const eventPath = ref('')
const topologySize = ref({ width: 1, height: 1 })
const messageIds = ['tx1', 'tx2', 'tx3'] as const

const nodeLabels: Record<RocketNodeId, string> = {
  producer: 'Producer',
  'local-db': 'Local DB',
  broker: 'Broker',
  consumer: 'Consumer',
}

const totalChecks = computed(() =>
  frame.value.broker.halfMessages.reduce((sum, half) => sum + half.checkCount, 0),
)

function isRouteNode(nodeId: RocketNodeId) {
  const route = frame.value.event.route
  return route?.from === nodeId || route?.to === nodeId
}

function localTransactionState(messageId: RocketMessageId): RocketTransactionState | 'none' {
  return frame.value.producer.localTransactions.find((transaction) => transaction.messageId === messageId)?.state ?? 'none'
}

function brokerMessageState(messageId: RocketMessageId) {
  if (frame.value.broker.halfMessages.some(({ message }) => message.id === messageId)) return 'HALF'
  if (frame.value.broker.ready.some(({ id }) => id === messageId)) return 'READY'
  if (frame.value.broker.rolledBack.includes(messageId)) return 'ROLLBACK'
  if (frame.value.consumer.current?.id === messageId) return 'INFLIGHT'
  if (frame.value.consumer.consumed.includes(messageId)) return 'CONSUMED'
  return '—'
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

  if (Math.abs(dy) < 48) {
    const lift = Math.max(18, Math.min(38, Math.abs(dx) * 0.15))
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
  <section class="lab" aria-labelledby="rocket-title">
    <header class="lab-heading lab-heading--redis">
      <div>
        <div class="eyebrow eyebrow--rocket"><Rocket :size="15" /> RocketMQ · Transaction Message</div>
        <h1 id="rocket-title">Half Message、二阶段确认与事务回查</h1>
        <p>对比正常 Commit、明确 Rollback，以及 Commit 丢失后由 Broker 发起状态回查的三条路径。</p>
      </div>
      <div class="scenario-chip">
        <span class="scenario-chip__dot scenario-chip__dot--rocket" />
        Transaction Topic · Half · Commit · Check
      </div>
    </header>

    <div class="lab-meta lab-meta--redis" aria-label="当前 RocketMQ 状态">
      <span><strong>{{ frame.phase }}</strong><small>当前阶段</small></span>
      <span><strong>{{ frame.broker.halfMessages.length }} Half · {{ frame.broker.ready.length }} Ready</strong><small>Broker 事务存储</small></span>
      <span><strong>{{ totalChecks }} Check · {{ frame.consumer.consumed.length }} Consumed</strong><small>回查与消费</small></span>
    </div>

    <div class="lab-layout lab-layout--redis">
      <div class="stage-panel stage-panel--redis">
        <div class="stage-heading stage-heading--redis">
          <div>
            <span class="step-index step-index--rocket">{{ String(player.step.value + 1).padStart(2, '0') }}</span>
            <div>
              <h2>{{ frame.title }}</h2>
              <p>{{ frame.description }}</p>
            </div>
          </div>
          <code>{{ frame.context }}</code>
        </div>

        <div class="diagram-wrap rocket-topology-wrap">
          <div
            ref="topology"
            class="rocket-topology"
            role="img"
            :aria-label="`${frame.phase}：${frame.title}`"
          >
            <svg
              class="rocket-event-layer"
              :viewBox="`0 0 ${topologySize.width} ${topologySize.height}`"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <marker id="rocket-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0 0 L8 4 L0 8 Z" class="rocket-arrow-head" />
                </marker>
              </defs>
              <path
                v-if="eventPath"
                ref="eventPathElement"
                :d="eventPath"
                class="rocket-event-path"
                :class="`kind-${frame.event.kind}`"
                marker-end="url(#rocket-arrow)"
              />
              <g
                v-if="eventPath"
                ref="messageDot"
                class="rocket-message-dot"
                :class="`kind-${frame.event.kind}`"
              >
                <circle r="9" class="rocket-message-dot__ring" />
                <circle r="4" />
              </g>
            </svg>

            <section class="rocket-producer-system">
              <article
                class="rocket-producer rocket-node"
                :class="{ 'is-active': isRouteNode('producer') }"
                data-route-id="producer"
              >
                <header><Rocket :size="14" /><strong>Transaction Producer</strong><small>{{ frame.producer.status.toUpperCase() }}</small></header>
                <div class="rocket-node-body">
                  <span class="rocket-feature is-on">Transaction Checker</span>
                  <small>当前消息</small>
                  <strong>{{ frame.producer.current?.id.toUpperCase() ?? '—' }}</strong>
                  <code>{{ frame.producer.current?.key ?? '等待发送' }}</code>
                </div>
              </article>
              <article
                class="rocket-database rocket-node"
                :class="{ 'is-active': isRouteNode('local-db') }"
                data-route-id="local-db"
              >
                <header><Database :size="14" /><strong>Local Transaction DB</strong></header>
                <div class="rocket-local-list">
                  <div v-for="transaction in frame.producer.localTransactions" :key="transaction.messageId">
                    <strong>{{ transaction.orderId }}</strong>
                    <span :class="`is-${transaction.state}`">{{ transaction.state }}</span>
                  </div>
                  <small v-if="!frame.producer.localTransactions.length">暂无本地事务</small>
                </div>
              </article>
            </section>

            <article
              class="rocket-broker rocket-node"
              :class="{ 'is-active': isRouteNode('broker') }"
              data-route-id="broker"
            >
              <header><Server :size="14" /><strong>RocketMQ Broker</strong><small>{{ frame.broker.topicType }}</small></header>
              <code class="rocket-topic">{{ frame.broker.topic }}</code>
              <div class="rocket-broker-zones">
                <section>
                  <header><strong>Half / Pending</strong><span>{{ frame.broker.halfMessages.length }}</span></header>
                  <div>
                    <span v-for="half in frame.broker.halfMessages" :key="half.message.id">
                      {{ half.message.id.toUpperCase() }}<small>check {{ half.checkCount }}</small>
                    </span>
                    <small v-if="!frame.broker.halfMessages.length">不可见区为空</small>
                  </div>
                </section>
                <section>
                  <header><strong>Ready / Deliverable</strong><span>{{ frame.broker.ready.length }}</span></header>
                  <div>
                    <span v-for="item in frame.broker.ready" :key="item.id">{{ item.id.toUpperCase() }}</span>
                    <small v-if="!frame.broker.ready.length">可投递区为空</small>
                  </div>
                </section>
              </div>
              <footer><span>Rolled Back</span><code>{{ frame.broker.rolledBack.join(', ').toUpperCase() || '—' }}</code></footer>
            </article>

            <article
              class="rocket-consumer rocket-node"
              :class="{ 'is-active': isRouteNode('consumer') }"
              data-route-id="consumer"
            >
              <header><UserCheck :size="14" /><strong>Consumer</strong><small>{{ frame.consumer.status.toUpperCase() }}</small></header>
              <div class="rocket-consumer-body">
                <small>当前可见消息</small>
                <strong>{{ frame.consumer.current?.id.toUpperCase() ?? '等待投递' }}</strong>
                <code>{{ frame.consumer.current?.key ?? 'Half Message 不可见' }}</code>
              </div>
              <footer><span>Consumed</span><code>{{ frame.consumer.consumed.join(', ').toUpperCase() || '—' }}</code></footer>
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

      <aside class="inspector-panel inspector-panel--redis rocket-inspector" aria-label="RocketMQ 状态检查器">
        <div class="inspector-heading">
          <span><Activity :size="16" /> RocketMQ 事务状态</span>
          <span class="status-badge is-live">24 STEPS</span>
        </div>

        <div class="inspector-section-label rocket-inspector__first-label">事务消息对照</div>
        <div class="rocket-transaction-table" role="table" aria-label="RocketMQ 事务消息状态">
          <div class="rocket-transaction-row is-header" role="row">
            <span role="columnheader">消息</span><span role="columnheader">本地事务</span><span role="columnheader">Broker</span>
          </div>
          <div v-for="messageId in messageIds" :key="messageId" class="rocket-transaction-row" role="row">
            <strong role="cell">{{ messageId.toUpperCase() }}</strong>
            <span role="cell" :class="`is-${localTransactionState(messageId)}`">{{ localTransactionState(messageId) }}</span>
            <span role="cell">{{ brokerMessageState(messageId) }}</span>
          </div>
        </div>

        <div class="inspector-section-label">状态边界</div>
        <div class="rocket-boundaries">
          <section><strong>HALF</strong><span>Broker 已接收，Consumer 不可见</span></section>
          <section><strong>COMMIT</strong><span>进入 Ready，允许投递</span></section>
          <section><strong>ROLLBACK</strong><span>终止事务消息，不投递</span></section>
          <section><strong>CHECK</strong><span>根据本地事务表收敛状态</span></section>
        </div>

        <div class="event-message" :class="`kind-${frame.event.kind}`">
          <span class="event-pulse" />
          <div>
            <small>当前事件</small>
            <strong v-if="frame.event.route">
              {{ nodeLabels[frame.event.route.from] }} → {{ nodeLabels[frame.event.route.to] }}
            </strong>
            <strong v-else>Broker 状态变化</strong>
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
