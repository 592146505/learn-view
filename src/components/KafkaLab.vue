<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'
import { Activity, Database, Layers3, MessagesSquare, Send, Server, Users } from '@lucide/vue'
import PlayerControls from './PlayerControls.vue'
import { useStepPlayer } from '../composables/useStepPlayer'
import {
  kafkaFrames,
  type KafkaBrokerId,
  type KafkaConsumerGroupId,
  type KafkaConsumerMemberState,
  type KafkaNodeId,
  type KafkaPartitionState,
} from '../simulations/kafka'

const total = computed(() => kafkaFrames.length)
const player = useStepPlayer(total)
const frame = computed(() => kafkaFrames[player.step.value])
const stepLabels = kafkaFrames.map(({ title }) => title)
const topology = ref<HTMLDivElement | null>(null)
const eventPathElement = ref<SVGPathElement | null>(null)
const messageDot = ref<SVGGElement | null>(null)
const eventPath = ref('')
const topologySize = ref({ width: 1, height: 1 })

const brokerLabels: Record<KafkaBrokerId, string> = {
  b1: 'B1',
  b2: 'B2',
  b3: 'B3',
}

const producerStatusLabels = {
  idle: 'IDLE',
  routing: 'ROUTING',
  'waiting-replicas': 'WAIT ISR',
  acked: 'ACKED',
} as const

const groupLabels: Record<KafkaConsumerGroupId, string> = {
  analytics: 'Analytics',
  billing: 'Billing',
}

const upBrokerCount = computed(() => frame.value.brokers.filter(({ status }) => status === 'up').length)
const activePartition = computed(() => {
  const partitionId = frame.value.event.partition
  return partitionId === null
    ? null
    : frame.value.partitions.find(({ id }) => id === partitionId) ?? null
})
const producerStatus = computed(() => producerStatusLabels[frame.value.producer.status])
const producerRecord = computed(() => frame.value.producer.current)
const groupOffsetSummary = computed(() =>
  frame.value.groups.map((group) => ({
    id: group.id,
    total: Object.values(group.committedOffsets).reduce((sum, offset) => sum + offset, 0),
  })),
)

function replicaOn(partition: KafkaPartitionState, brokerId: KafkaBrokerId) {
  return partition.replicas.find(({ broker }) => broker === brokerId)
}

function memberLabel(memberId: string) {
  const [group, consumer] = memberId.split('-c')
  return `${group === 'analytics' ? 'A' : 'B'}${consumer}`
}

function assignmentLabel(member: KafkaConsumerMemberState) {
  return member.assignments.length
    ? member.assignments.map((partition) => `P${partition}`).join(' · ')
    : '等待分配'
}

function positionLabel(member: KafkaConsumerMemberState) {
  if (!member.assignments.length) return 'position —'
  return member.assignments
    .map((partition) => `P${partition}:${member.positions[partition] ?? 0}`)
    .join(' · ')
}

function committedLabel(groupId: KafkaConsumerGroupId) {
  const group = frame.value.groups.find(({ id }) => id === groupId)
  if (!group) return 'P0:0 · P1:0 · P2:0'
  return ([0, 1, 2] as const)
    .map((partition) => `P${partition}:${group.committedOffsets[partition]}`)
    .join(' · ')
}

function isRouteNode(nodeId: KafkaNodeId) {
  const route = frame.value.event.route
  return route?.from === nodeId || route?.to === nodeId
}

function routeEndpoint(nodeId: KafkaNodeId) {
  if (nodeId.startsWith('b') && frame.value.event.partition !== null) {
    return `${nodeId}-p${frame.value.event.partition}`
  }
  return nodeId
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

  const fromId = routeEndpoint(route.from)
  const toId = routeEndpoint(route.to)
  const fromElement = container.querySelector(`[data-route-id="${fromId}"]`)
  const toElement = container.querySelector(`[data-route-id="${toId}"]`)
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

  if (Math.abs(dy) < 56) {
    const lift = Math.max(18, Math.min(38, Math.abs(dx) * 0.16))
    eventPath.value = `M${start.x} ${start.y} Q${(start.x + end.x) / 2} ${start.y - lift} ${end.x} ${end.y}`
    return
  }

  const middleY = start.y + dy / 2
  eventPath.value = `M${start.x} ${start.y} C${start.x} ${middleY} ${end.x} ${middleY} ${end.x} ${end.y}`
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
  topologyResizeObserver = new ResizeObserver(() => {
    syncEventPath()
    nextTick(() => {
      const path = eventPathElement.value
      if (!path || !messageDot.value) return
      const end = path.getPointAtLength(path.getTotalLength())
      gsap.set(messageDot.value, { x: end.x, y: end.y })
    })
  })
  topologyResizeObserver.observe(topology.value)
})
onBeforeUnmount(() => {
  activeMessageTween?.kill()
  topologyResizeObserver?.disconnect()
})
</script>

<template>
  <section class="lab" aria-labelledby="kafka-title">
    <header class="lab-heading lab-heading--redis">
      <div>
        <div class="eyebrow eyebrow--kafka"><MessagesSquare :size="15" /> Kafka · orders</div>
        <h1 id="kafka-title">生产、复制与消费者组</h1>
        <p>一条记录如何选分区、跨 Broker 复制，并被多个消费组按各自进度读取。</p>
      </div>
      <div class="scenario-chip">
        <span class="scenario-chip__dot scenario-chip__dot--kafka" />
        3 Brokers · 3 Partitions · RF 3 · 2 Groups
      </div>
    </header>

    <div class="lab-meta lab-meta--redis" aria-label="当前 Kafka 状态">
      <span><strong>{{ frame.phase }}</strong><small>当前阶段</small></span>
      <span>
        <strong v-if="activePartition">P{{ activePartition.id }} · Leader {{ brokerLabels[activePartition.leader] }}</strong>
        <strong v-else>3 Partitions · RF 3</strong>
        <small>当前分区与副本</small>
      </span>
      <span>
        <strong>{{ groupOffsetSummary[0].total }} / {{ groupOffsetSummary[1].total }}</strong>
        <small>Analytics / Billing 已提交记录数</small>
      </span>
    </div>

    <div class="lab-layout lab-layout--redis">
      <div class="stage-panel stage-panel--redis">
        <div class="stage-heading stage-heading--redis">
          <div>
            <span class="step-index step-index--kafka">{{ String(player.step.value + 1).padStart(2, '0') }}</span>
            <div>
              <h2>{{ frame.title }}</h2>
              <p>{{ frame.description }}</p>
            </div>
          </div>
          <code>{{ frame.context }}</code>
        </div>

        <div class="diagram-wrap kafka-topology-wrap">
          <div
            ref="topology"
            class="kafka-topology"
            role="img"
            :aria-label="`${frame.phase}：${frame.title}`"
          >
            <svg
              class="kafka-event-layer"
              :viewBox="`0 0 ${topologySize.width} ${topologySize.height}`"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <marker id="kafka-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0 0 L8 4 L0 8 Z" class="kafka-arrow-head" />
                </marker>
              </defs>
              <path
                v-if="eventPath"
                ref="eventPathElement"
                :d="eventPath"
                class="kafka-event-path"
                :class="`kind-${frame.event.kind}`"
                marker-end="url(#kafka-arrow)"
              />
              <g
                v-if="eventPath"
                ref="messageDot"
                class="kafka-message-dot"
                :class="`kind-${frame.event.kind}`"
              >
                <circle r="9" class="kafka-message-dot__ring" />
                <circle r="4" />
              </g>
            </svg>

            <div class="kafka-producer-row">
              <div
                class="kafka-producer"
                :class="{ 'is-active': isRouteNode('producer') }"
                data-route-id="producer"
              >
                <span class="kafka-node-icon"><Send :size="16" /></span>
                <span><strong>Producer</strong><small>acks=all · {{ producerStatus }}</small></span>
                <code v-if="producerRecord">{{ producerRecord.key }} → P{{ producerRecord.partition }}</code>
                <code v-else>等待发送</code>
              </div>
            </div>

            <div class="kafka-broker-grid">
              <article
                v-for="broker in frame.brokers"
                :key="broker.id"
                class="kafka-broker"
                :class="{ 'is-down': broker.status === 'down', 'is-active': isRouteNode(broker.id) }"
              >
                <header>
                  <span><Server :size="15" /><strong>{{ brokerLabels[broker.id] }}</strong></span>
                  <small>{{ broker.status.toUpperCase() }}</small>
                </header>
                <div class="kafka-broker-partitions">
                  <div
                    v-for="partition in frame.partitions"
                    :key="partition.id"
                    class="kafka-partition-copy"
                    :class="{
                      'is-leader': replicaOn(partition, broker.id)?.role === 'leader',
                      'is-active': frame.event.partition === partition.id && isRouteNode(broker.id),
                      'is-out-of-sync': !replicaOn(partition, broker.id)?.inSync,
                    }"
                    :data-route-id="`${broker.id}-p${partition.id}`"
                  >
                    <strong>P{{ partition.id }}</strong>
                    <span>{{ replicaOn(partition, broker.id)?.role === 'leader' ? 'L' : 'F' }}</span>
                    <code>LEO {{ replicaOn(partition, broker.id)?.logEndOffset }}</code>
                    <small>HW {{ partition.highWatermark }}</small>
                  </div>
                </div>
              </article>
            </div>

            <div class="kafka-groups-grid">
              <article
                v-for="group in frame.groups"
                :key="group.id"
                class="kafka-group"
                :class="{ 'is-active': frame.event.group === group.id }"
              >
                <header>
                  <span><Users :size="14" /><strong>Group {{ groupLabels[group.id] }}</strong></span>
                  <small>gen {{ group.generation }} · {{ group.status }}</small>
                </header>
                <div v-if="group.members.length" class="kafka-group-members">
                  <div
                    v-for="member in group.members"
                    :key="member.id"
                    class="kafka-consumer"
                    :class="{ 'is-active': isRouteNode(member.id) }"
                    :data-route-id="member.id"
                  >
                    <strong>{{ memberLabel(member.id) }}</strong>
                    <span>{{ assignmentLabel(member) }}</span>
                    <code>{{ positionLabel(member) }}</code>
                  </div>
                </div>
                <div v-else class="kafka-group-empty">等待消费者加入</div>
                <footer><span>committed</span><code>{{ committedLabel(group.id) }}</code></footer>
              </article>
            </div>
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

      <aside class="inspector-panel inspector-panel--redis kafka-inspector" aria-label="Kafka 状态检查器">
        <div class="inspector-heading">
          <span><Activity :size="16" /> Kafka 状态 · orders</span>
          <span class="status-badge" :class="upBrokerCount === 3 ? 'is-live' : 'is-alert'">
            {{ upBrokerCount }} / 3 UP
          </span>
        </div>

        <div class="inspector-section-label kafka-inspector__first-label">分区副本状态</div>
        <div class="candidate-table kafka-partition-table" role="table" aria-label="Kafka 分区副本状态">
          <div class="candidate-row candidate-row--header" role="row">
            <span role="columnheader">分区</span><span role="columnheader">Leader</span><span role="columnheader">ISR</span><span role="columnheader">HW</span>
          </div>
          <div
            v-for="partition in frame.partitions"
            :key="partition.id"
            class="candidate-row"
            :class="{ 'is-selected': frame.event.partition === partition.id }"
            role="row"
          >
            <strong role="cell">P{{ partition.id }}</strong>
            <span role="cell">{{ brokerLabels[partition.leader] }}</span>
            <span role="cell">{{ partition.replicas.filter(({ inSync }) => inSync).map(({ broker }) => brokerLabels[broker]).join(',') }}</span>
            <span role="cell">{{ partition.highWatermark }}</span>
          </div>
        </div>

        <div class="kafka-group-state-list">
          <section
            v-for="group in frame.groups"
            :key="group.id"
            class="kafka-group-state"
            :class="{ 'is-active': frame.event.group === group.id }"
          >
            <header>
              <strong>Group {{ groupLabels[group.id] }}</strong>
              <span>{{ group.members.length }} members · gen {{ group.generation }}</span>
            </header>
            <div v-if="group.members.length" class="kafka-group-state__members">
              <div v-for="member in group.members" :key="member.id">
                <strong>{{ memberLabel(member.id) }}</strong>
                <span>{{ assignmentLabel(member) }}</span>
              </div>
            </div>
            <div v-else class="kafka-group-state__empty">暂无成员</div>
            <code>{{ committedLabel(group.id) }}</code>
          </section>
        </div>

        <div class="event-message" :class="`kind-${frame.event.kind}`">
          <span class="event-pulse" />
          <div>
            <small>当前事件</small>
            <strong v-if="frame.event.route">
              {{ frame.event.route.from.toUpperCase() }} → {{ frame.event.route.to.toUpperCase() }}
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
