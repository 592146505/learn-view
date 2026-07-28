<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'
import { Activity, Crown, Database, Hash, Network, Server, TriangleAlert, Vote } from '@lucide/vue'
import PlayerControls from './PlayerControls.vue'
import { useStepPlayer } from '../composables/useStepPlayer'
import {
  clusterFrames,
  clusterNodePositions,
  masterConfigEpochs,
  type ClusterEventRoute,
  type ClusterNodeId,
} from '../simulations/cluster'

const total = computed(() => clusterFrames.length)
const player = useStepPlayer(total)
const frame = computed(() => clusterFrames[player.step.value])
const stepLabels = clusterFrames.map(({ title }) => title)
const diagram = ref<SVGSVGElement | null>(null)
const diagramViewBoxHeight = ref(520)
const messageDot = ref<SVGGElement | null>(null)
const replicaLayerOffsetY = computed(() => Math.max(0, (diagramViewBoxHeight.value - 520) * 0.65))
const replicaSectionTitleY = computed(() => 286 + replicaLayerOffsetY.value)
const topologyCaptionY = computed(() => Math.max(480, diagramViewBoxHeight.value - 30))
const failureProgress = computed(() => Math.min(100, frame.value.failureReports / 2 * 100))
const voteProgress = computed(() => Math.min(100, frame.value.votes / 2 * 100))
const observerLabel = computed(() => frame.value.observer.toUpperCase())
const observerM2View = computed(() => frame.value.m2Views[frame.value.observer])
const observerClusterState = computed(() => frame.value.clusterStates[frame.value.observer])
const observerSlotOwner = computed(() => frame.value.slotOwners[frame.value.observer])
const slotOwnerLabel = computed(() => observerSlotOwner.value.toUpperCase())
const slotEpoch = computed(() => observerSlotOwner.value === 'r2' ? 8 : masterConfigEpochs.m2)

const masters = [
  { id: 'm1' as ClusterNodeId, label: 'M1', slots: '0-5460', configEpoch: masterConfigEpochs.m1 },
  { id: 'm2' as ClusterNodeId, label: 'M2', slots: '5461-10922', configEpoch: masterConfigEpochs.m2 },
  { id: 'm3' as ClusterNodeId, label: 'M3', slots: '10923-16383', configEpoch: masterConfigEpochs.m3 },
]

const replicas = [
  { id: 'r1' as ClusterNodeId, label: 'R1', upstream: 'M1', offset: '247920' },
  { id: 'r2' as ClusterNodeId, label: 'R2', upstream: 'M2', offset: '248100' },
  { id: 'r3' as ClusterNodeId, label: 'R3', upstream: 'M3', offset: '247840' },
]

const positions = new Map(clusterNodePositions.map((position) => [position.id, position]))

function getPoint(id: ClusterNodeId) {
  const position = positions.get(id) ?? clusterNodePositions[0]
  if (position.layer === 'replica') {
    return { ...position, y: position.y + replicaLayerOffsetY.value }
  }
  if (position.layer === 'client') {
    return { ...position, y: position.y + replicaLayerOffsetY.value * 0.42 }
  }
  return position
}

function hasUpperArc(route: ClusterEventRoute) {
  return (route.from === 'm1' && route.to === 'm3') || (route.from === 'm3' && route.to === 'm1')
}

function hasClientReplicaArc(route: ClusterEventRoute) {
  return (route.from === 'client' && route.to === 'r2') || (route.from === 'r2' && route.to === 'client')
}

function eventControlPoint(route: ClusterEventRoute) {
  if (hasUpperArc(route)) return { x: 525, y: 34 }
  if (hasClientReplicaArc(route)) {
    return { x: 300, y: 235 + replicaLayerOffsetY.value * 0.15 }
  }
  return null
}

function eventPath(route: ClusterEventRoute) {
  const from = getPoint(route.from)
  const to = getPoint(route.to)
  const control = eventControlPoint(route)
  if (control) return `M${from.x} ${from.y} Q${control.x} ${control.y} ${to.x} ${to.y}`
  return `M${from.x} ${from.y} L${to.x} ${to.y}`
}

function pointOnEventPath(route: ClusterEventRoute, progress: number) {
  const from = getPoint(route.from)
  const to = getPoint(route.to)
  const control = eventControlPoint(route)
  if (!control) {
    return {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
    }
  }

  const remaining = 1 - progress
  return {
    x: remaining * remaining * from.x + 2 * remaining * progress * control.x + progress * progress * to.x,
    y: remaining * remaining * from.y + 2 * remaining * progress * control.y + progress * progress * to.y,
  }
}

function eventLabelPoint(route: ClusterEventRoute) {
  const midpoint = pointOnEventPath(route, 0.5)
  return { x: midpoint.x, y: midpoint.y - (hasUpperArc(route) ? 18 : 12) }
}

function masterClasses(id: ClusterNodeId) {
  return id === 'm2' ? { 'is-down': frame.value.m2Reachability === 'down' } : {}
}

function masterStatus(id: ClusterNodeId) {
  if (id === 'm2') return frame.value.m2Reachability === 'up' ? 'UP' : 'DOWN'
  if (id === 'm1' || id === 'm3') return frame.value.m2Views[id]
  return 'OK'
}

function masterStatusLabel(id: ClusterNodeId) {
  return id === 'm2' ? 'physical' : 'view M2'
}

function masterStatusClass(id: ClusterNodeId) {
  const status = masterStatus(id).toLowerCase()
  return `is-${status}-view`
}

function masterSlotLabel(id: ClusterNodeId) {
  return id === 'm2' && frame.value.r2Role === 'master' ? 'old config' : 'slots'
}

function masterSlotValue(id: ClusterNodeId, slots: string) {
  return id === 'm2' && frame.value.r2Role === 'master' ? 'stale · e7' : slots
}

function replicaRole(id: ClusterNodeId) {
  if (id !== 'r2') return 'REPLICA'
  return frame.value.r2Role.toUpperCase()
}

function replicaDetailLabel(id: ClusterNodeId) {
  if (id !== 'r2') return 'offset'
  if (frame.value.r2Role === 'master') return 'configEpoch'
  if (frame.value.r2Role === 'candidate' && frame.value.currentEpoch === 8) return 'currentEpoch'
  return 'offset'
}

function replicaDetailValue(id: ClusterNodeId, offset: string) {
  if (id !== 'r2') return offset
  if (frame.value.r2Role === 'master') return frame.value.r2ConfigEpoch
  if (frame.value.r2Role === 'candidate' && frame.value.currentEpoch === 8) return frame.value.currentEpoch
  return offset
}

function isObserver(id: ClusterNodeId) {
  return frame.value.observer === id
}

let activeMessageTween: gsap.core.Tween | null = null

function animateMessage() {
  nextTick(() => {
    activeMessageTween?.kill()
    activeMessageTween = null
    const route = frame.value.event.route
    if (!messageDot.value || !route) return
    const from = getPoint(route.from)
    gsap.set(messageDot.value, { x: from.x, y: from.y })

    const motion = { progress: 0 }
    activeMessageTween = gsap.to(motion, {
      progress: 1,
      duration: 0.9,
      ease: 'power2.inOut',
      onUpdate: () => {
        if (!messageDot.value) return
        const point = pointOnEventPath(route, motion.progress)
        gsap.set(messageDot.value, { x: point.x, y: point.y })
      },
    })
  })
}

let diagramResizeObserver: ResizeObserver | null = null

function syncDiagramViewBox() {
  if (!diagram.value || !diagram.value.clientWidth || !diagram.value.clientHeight) return
  diagramViewBoxHeight.value = Math.max(
    500,
    Math.round(diagram.value.clientHeight / diagram.value.clientWidth * 940),
  )
}

watch([player.step, replicaLayerOffsetY], animateMessage)
onMounted(() => {
  animateMessage()
  if (!diagram.value) return

  diagramResizeObserver = new ResizeObserver(syncDiagramViewBox)
  diagramResizeObserver.observe(diagram.value)
  syncDiagramViewBox()
})
onBeforeUnmount(() => {
  activeMessageTween?.kill()
  diagramResizeObserver?.disconnect()
})
</script>

<template>
  <section class="lab" aria-labelledby="cluster-title">
    <header class="lab-heading lab-heading--redis">
      <div>
        <div class="eyebrow eyebrow--redis"><Network :size="15" /> Redis · Cluster</div>
        <h1 id="cluster-title">槽位路由与故障转移</h1>
        <p>从 MOVED 路由到 PFAIL、FAIL 与副本晋升，观察槽位所有权如何收敛。</p>
      </div>
      <div class="scenario-chip">
        <span class="scenario-chip__dot" />
        3M · 3R · full coverage
      </div>
    </header>

    <div class="lab-meta lab-meta--redis" aria-label="当前 Cluster 状态">
      <span><strong>{{ frame.phase }}</strong><small>当前阶段</small></span>
      <span><strong>{{ observerLabel }} · {{ observerM2View }}</strong><small>M2 本地故障视图</small></span>
      <span><strong>{{ slotOwnerLabel }} · e{{ slotEpoch }}</strong><small>{{ observerLabel }} 本地槽位表</small></span>
    </div>

    <div class="lab-layout lab-layout--redis">
      <div class="stage-panel stage-panel--redis">
        <div class="stage-heading stage-heading--redis">
          <div>
            <span class="step-index step-index--redis">{{ String(player.step.value + 1).padStart(2, '0') }}</span>
            <div>
              <h2>{{ frame.title }}</h2>
              <p>{{ frame.description }}</p>
            </div>
          </div>
          <code>{{ frame.context }}</code>
        </div>

        <div class="diagram-wrap">
          <svg
            ref="diagram"
            class="cluster-diagram"
            :viewBox="`0 0 940 ${diagramViewBoxHeight}`"
            role="img"
            :aria-label="`${frame.phase}：${frame.title}`"
          >
            <defs>
              <marker id="cluster-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0 0 L8 4 L0 8 Z" class="arrow-head" />
              </marker>
            </defs>

            <text x="190" y="34" class="svg-section-title">主节点 · 槽位所有者</text>
            <text x="190" :y="replicaSectionTitleY" class="svg-section-title">从节点 · 故障转移候选</text>

            <line x1="270" y1="120" x2="525" y2="120" class="cluster-bus-line" :class="{ 'is-broken': frame.m2Reachability === 'down' }" />
            <line x1="525" y1="120" x2="780" y2="120" class="cluster-bus-line" :class="{ 'is-broken': frame.m2Reachability === 'down' }" />
            <path d="M270 120 Q525 42 780 120" class="cluster-bus-line" />

            <line
              :x1="getPoint('m1').x"
              :y1="getPoint('m1').y + 48"
              :x2="getPoint('r1').x"
              :y2="getPoint('r1').y - 48"
              class="cluster-replication-line"
              marker-end="url(#cluster-arrow)"
            />
            <line
              v-if="frame.r2Role !== 'master'"
              :x1="getPoint('m2').x"
              :y1="getPoint('m2').y + 48"
              :x2="getPoint('r2').x"
              :y2="getPoint('r2').y - 48"
              class="cluster-replication-line"
              :class="{ 'is-broken': frame.m2Reachability === 'down' }"
              marker-end="url(#cluster-arrow)"
            />
            <line
              :x1="getPoint('m3').x"
              :y1="getPoint('m3').y + 48"
              :x2="getPoint('r3').x"
              :y2="getPoint('r3').y - 48"
              class="cluster-replication-line"
              marker-end="url(#cluster-arrow)"
            />

            <g class="cluster-client" :transform="`translate(${getPoint('client').x - 58} ${getPoint('client').y - 37})`">
              <rect width="116" height="74" rx="7" />
              <g transform="translate(15 14)"><Hash :size="17" /></g>
              <text x="40" y="28" class="cluster-node-title">CLIENT</text>
              <text x="15" y="51" class="cluster-node-meta">cart:{42}</text>
              <text x="15" y="65" class="cluster-node-value">slot 8000</text>
            </g>

            <g
              v-for="master in masters"
              :key="master.id"
              class="cluster-node cluster-node--master"
              :class="masterClasses(master.id)"
              :transform="`translate(${getPoint(master.id).x - 82} ${getPoint(master.id).y - 48})`"
            >
              <text v-if="isObserver(master.id)" x="82" y="-10" text-anchor="middle" class="cluster-observer-label">当前视角</text>
              <rect width="164" height="96" rx="7" />
              <g transform="translate(16 14)"><Database :size="18" /></g>
              <text x="44" y="29" class="cluster-node-title">{{ master.label }}</text>
              <text x="148" y="28" text-anchor="end" class="cluster-node-role">MASTER</text>
              <line x1="16" y1="43" x2="148" y2="43" class="node-divider" />
              <text x="16" y="63" class="cluster-node-meta">{{ masterSlotLabel(master.id) }}</text>
              <text x="148" y="63" text-anchor="end" class="cluster-node-value">{{ masterSlotValue(master.id, master.slots) }}</text>
              <text x="16" y="82" class="cluster-node-meta">{{ masterStatusLabel(master.id) }}</text>
              <text x="148" y="82" text-anchor="end" class="cluster-node-value" :class="masterStatusClass(master.id)">{{ masterStatus(master.id) }}</text>
            </g>

            <g
              v-for="replica in replicas"
              :key="replica.id"
              class="cluster-node cluster-node--replica"
              :class="replica.id === 'r2' ? `is-${frame.r2Role}` : ''"
              :transform="`translate(${getPoint(replica.id).x - 82} ${getPoint(replica.id).y - 48})`"
            >
              <text v-if="isObserver(replica.id)" x="82" y="-10" text-anchor="middle" class="cluster-observer-label">当前视角</text>
              <rect width="164" height="96" rx="7" />
              <g transform="translate(16 14)"><Server :size="18" /></g>
              <text x="44" y="29" class="cluster-node-title">{{ replica.label }}</text>
              <text x="148" y="28" text-anchor="end" class="cluster-node-role">{{ replicaRole(replica.id) }}</text>
              <g v-if="replica.id === 'r2' && frame.r2Role === 'master'" transform="translate(66 13)"><Crown :size="15" /></g>
              <line x1="16" y1="43" x2="148" y2="43" class="node-divider" />
              <text x="16" y="63" class="cluster-node-meta">{{ replica.id === 'r2' && frame.r2Role === 'master' ? 'slots' : 'replica of' }}</text>
              <text x="148" y="63" text-anchor="end" class="cluster-node-value">
                {{ replica.id === 'r2' && frame.r2Role === 'master' ? '5461-10922' : replica.upstream }}
              </text>
              <text x="16" y="82" class="cluster-node-meta">{{ replicaDetailLabel(replica.id) }}</text>
              <text x="148" y="82" text-anchor="end" class="cluster-node-value">
                {{ replicaDetailValue(replica.id, replica.offset) }}
              </text>
            </g>

            <g v-if="frame.event.route" class="message-path cluster-message-path" :class="`kind-${frame.event.kind}`">
              <path :d="eventPath(frame.event.route)" />
              <text
                :x="eventLabelPoint(frame.event.route).x"
                :y="eventLabelPoint(frame.event.route).y"
                text-anchor="middle"
              >{{ frame.event.label }}</text>
            </g>

            <g v-if="frame.event.route" ref="messageDot" class="message-dot" :class="`kind-${frame.event.kind}`" aria-hidden="true">
              <circle r="10" class="message-dot-ring" />
              <circle r="4" />
            </g>

            <text x="525" :y="topologyCaptionY" text-anchor="middle" class="topology-caption">
              {{ observerLabel }} 本地视图 · slot 8000 → {{ slotOwnerLabel }} · configEpoch {{ slotEpoch }}
            </text>
          </svg>
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

      <aside class="inspector-panel inspector-panel--redis" :aria-label="`${observerLabel} Redis Cluster 状态检查器`">
        <div class="inspector-heading">
          <span><Activity :size="16" /> Cluster 状态 · {{ observerLabel }}</span>
          <span class="status-badge" :class="observerClusterState === 'ok' ? 'is-live' : 'is-alert'">
            {{ observerLabel }} · {{ observerClusterState.toUpperCase() }}
          </span>
        </div>

        <div class="decision-counter">
          <span class="counter-icon"><TriangleAlert :size="17" /></span>
          <div><small>M1 已计故障报告 · ≥ 2</small><strong>{{ frame.failureReports }} / 3</strong></div>
        </div>
        <div class="counter-track"><span :style="{ width: `${failureProgress}%` }" /></div>

        <div class="decision-counter">
          <span class="counter-icon counter-icon--vote"><Vote :size="17" /></span>
          <div><small>R2 已计授权票 · ≥ 2</small><strong>{{ frame.votes }} / 3</strong></div>
        </div>
        <div class="counter-track counter-track--vote"><span :style="{ width: `${voteProgress}%` }" /></div>

        <div class="inspector-section-label">{{ observerLabel }} 本地槽位表</div>
        <div class="candidate-table cluster-slot-table" role="table" :aria-label="`${observerLabel} Redis Cluster 本地槽位表`">
          <div class="candidate-row candidate-row--header" role="row">
            <span role="columnheader">槽位</span><span role="columnheader">所有者</span><span role="columnheader">Epoch</span>
          </div>
          <div class="candidate-row" role="row">
            <strong role="cell">0-5460</strong><span role="cell">M1</span><span role="cell">{{ masterConfigEpochs.m1 }}</span>
          </div>
          <div class="candidate-row" :class="{ 'is-selected': observerSlotOwner === 'r2', 'is-failed': observerClusterState === 'fail' && observerSlotOwner === 'm2' }" role="row">
            <strong role="cell">5461-10922</strong><span role="cell">{{ slotOwnerLabel }}</span><span role="cell">{{ slotEpoch }}</span>
          </div>
          <div class="candidate-row" role="row">
            <strong role="cell">10923-16383</strong><span role="cell">M3</span><span role="cell">{{ masterConfigEpochs.m3 }}</span>
          </div>
        </div>

        <div class="event-message" :class="`kind-${frame.event.kind}`">
          <span class="event-pulse" />
          <div>
            <small>当前事件</small>
            <strong v-if="frame.event.route">{{ frame.event.route.from.toUpperCase() }} → {{ frame.event.route.to.toUpperCase() }}</strong>
            <strong v-else>本地状态变化</strong>
            <code>{{ frame.event.label }}</code>
          </div>
        </div>

        <div class="protocol-note">
          <Network :size="18" />
          <p><strong>{{ frame.ruleTitle }}</strong><span>{{ frame.rule }}</span></p>
        </div>
      </aside>
    </div>
  </section>
</template>
