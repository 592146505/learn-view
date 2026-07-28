<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'
import { Activity, Check, Crown, RadioTower, Server, Vote } from '@lucide/vue'
import PlayerControls from './PlayerControls.vue'
import { useStepPlayer } from '../composables/useStepPlayer'
import { redisFrames, redisNodePositions, sentinelPositions, type ReplicaRole } from '../simulations/redis'

const total = computed(() => redisFrames.length)
const player = useStepPlayer(total)
const frame = computed(() => redisFrames[player.step.value])
const diagram = ref<SVGSVGElement | null>(null)
const diagramViewBoxHeight = ref(520)
const messageDot = ref<SVGGElement | null>(null)
const stepLabels = redisFrames.map(({ title }) => title)
const quorumProgress = computed(() => Math.min(100, frame.value.quorumVotes / 2 * 100))
const authorizationProgress = computed(() => Math.min(100, frame.value.authorizationVotes / 3 * 100))
const currentMaster = computed(() => {
  if (frame.value.r1Role === 'master') return 'R1'
  return frame.value.m0Reachability === 'up' ? 'M0' : '—'
})
const coordinatorLabel = computed(() => {
  if (frame.value.leader) return 'S1 是本轮协调者'
  if (frame.value.authorizationVotes > 0) return 'S1 正在竞选本轮协调者'
  return '尚未选出协调者'
})
const redisLayerOffsetY = computed(() => Math.max(0, (diagramViewBoxHeight.value - 520) * 0.65))
const redisNodeY = computed(() => 360 + redisLayerOffsetY.value)
const redisNodeTopY = computed(() => redisNodeY.value - 54)
const redisSectionTitleY = computed(() => 264 + redisLayerOffsetY.value)
const topologyCaptionY = computed(() => Math.max(462, diagramViewBoxHeight.value - 38))

const allPositions = [...sentinelPositions, ...redisNodePositions]
const redisPositionIds = new Set(redisNodePositions.map(({ id }) => id))

function getPoint(id: string) {
  const position = allPositions.find((item) => item.id === id) ?? allPositions[0]
  return redisPositionIds.has(position.id)
    ? { ...position, y: position.y + redisLayerOffsetY.value }
    : position
}

function animateMessage() {
  nextTick(() => {
    const route = frame.value.event.route
    if (!messageDot.value || !route) return
    const from = getPoint(route.from)
    const to = getPoint(route.to)
    gsap.killTweensOf(messageDot.value)
    gsap.set(messageDot.value, { x: from.x, y: from.y })
    gsap.to(messageDot.value, {
      x: to.x,
      y: to.y,
      duration: 0.85,
      ease: 'power2.inOut',
    })
  })
}

function roleLabel(role: ReplicaRole) {
  const labels: Record<ReplicaRole, string> = {
    replica: 'REPLICA',
    candidate: 'CANDIDATE',
    selected: 'SELECTED',
    promoting: 'PROMOTING',
    master: 'MASTER',
  }
  return labels[role]
}

let diagramResizeObserver: ResizeObserver | null = null

function syncDiagramViewBox() {
  if (!diagram.value || !diagram.value.clientWidth || !diagram.value.clientHeight) return
  diagramViewBoxHeight.value = Math.max(
    500,
    Math.round(diagram.value.clientHeight / diagram.value.clientWidth * 940),
  )
}

watch([player.step, redisLayerOffsetY], animateMessage)
onMounted(() => {
  animateMessage()
  if (!diagram.value) return

  diagramResizeObserver = new ResizeObserver(syncDiagramViewBox)
  diagramResizeObserver.observe(diagram.value)
  syncDiagramViewBox()
})
onBeforeUnmount(() => diagramResizeObserver?.disconnect())
</script>

<template>
  <section class="lab" aria-labelledby="redis-title">
    <header class="lab-heading lab-heading--redis">
      <div>
        <div class="eyebrow eyebrow--redis"><RadioTower :size="15" /> Redis · Sentinel</div>
        <h1 id="redis-title">故障转移实验</h1>
        <p>从主观下线到拓扑收敛，拆开每一次判断、授权与角色变化。</p>
      </div>
      <div class="scenario-chip">
        <span class="scenario-chip__dot" />
        5 Sentinel · quorum 2
      </div>
    </header>

    <div class="lab-meta lab-meta--redis" aria-label="当前状态">
      <span><strong>{{ frame.phase }}</strong><small>当前阶段</small></span>
      <span><strong>{{ frame.quorumVotes }} / 2</strong><small>ODOWN 确认</small></span>
      <span><strong>{{ currentMaster }}</strong><small>当前可用主库</small></span>
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
            class="redis-diagram"
            :viewBox="`0 0 940 ${diagramViewBoxHeight}`"
            role="img"
            :aria-label="`${frame.phase}：${frame.title}`"
          >
            <defs>
              <marker id="redis-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0 0 L8 4 L0 8 Z" class="arrow-head" />
              </marker>
            </defs>

            <text x="40" y="36" class="svg-section-title">Sentinel 监控层</text>
            <text x="40" :y="redisSectionTitleY" class="svg-section-title">Redis 数据层</text>

            <line
              v-for="sentinel in sentinelPositions"
              :key="`monitor-${sentinel.id}`"
              :x1="sentinel.x"
              :y1="sentinel.y + 36"
              x2="170"
              :y2="redisNodeTopY"
              class="monitor-line"
              :class="{ 'is-alert': frame.sentinelViews[sentinelPositions.indexOf(sentinel)] !== 'OK' }"
            />

            <g
              v-for="(sentinel, index) in sentinelPositions"
              :key="sentinel.id"
              class="sentinel-node"
              :class="[
                `is-${frame.sentinelViews[index].toLowerCase()}`,
                { 'is-leader': frame.leader === sentinel.id },
              ]"
              :transform="`translate(${sentinel.x - 55} ${sentinel.y - 34})`"
            >
              <rect width="110" height="74" rx="7" />
              <circle cx="19" cy="21" r="5" />
              <text x="32" y="26" class="sentinel-label">{{ sentinel.label }}</text>
              <text x="14" y="56" class="sentinel-status">{{ frame.sentinelViews[index] }}</text>
              <g v-if="frame.leader === sentinel.id" transform="translate(78 11)">
                <Crown :size="18" />
              </g>
            </g>

            <line
              v-if="frame.r1Upstream === 'm0'"
              x1="170"
              :y1="redisNodeY"
              x2="395"
              :y2="redisNodeY"
              class="replication-line"
              :class="{ 'is-broken': frame.m0Reachability === 'down' }"
              marker-end="url(#redis-arrow)"
            />
            <path
              v-if="frame.r2Upstream === 'm0'"
              :d="`M170 ${redisNodeY} C 310 ${redisNodeY + 95}, 620 ${redisNodeY + 95}, 770 ${redisNodeY}`"
              class="replication-line"
              :class="{ 'is-broken': frame.m0Reachability === 'down' }"
              marker-end="url(#redis-arrow)"
            />
            <line
              v-if="frame.r2Upstream === 'r1'"
              x1="470"
              :y1="redisNodeY"
              x2="695"
              :y2="redisNodeY"
              class="replication-line replication-line--new"
              marker-end="url(#redis-arrow)"
            />
            <line
              v-if="frame.m0Upstream === 'r1'"
              x1="470"
              :y1="redisNodeY"
              x2="245"
              :y2="redisNodeY"
              class="replication-line replication-line--new"
              marker-end="url(#redis-arrow)"
            />

            <g
              class="redis-node"
              :class="{
                'is-unreachable': frame.m0Reachability === 'down',
                'is-replica': frame.m0Role === 'replica',
                'is-recovered-master': frame.m0Reachability === 'up' && frame.m0Role === 'master' && frame.r1Role === 'master',
              }"
              :transform="`translate(90 ${redisNodeTopY})`"
            >
              <rect width="160" height="118" rx="7" />
              <g transform="translate(18 17)"><Server :size="18" /></g>
              <text x="45" y="32" class="redis-node-title">M0</text>
              <text x="142" y="31" text-anchor="end" class="redis-role">{{ frame.m0Role.toUpperCase() }}</text>
              <line x1="18" y1="48" x2="142" y2="48" class="node-divider" />
              <text x="18" y="75" class="field-label">状态</text>
              <text x="142" y="75" text-anchor="end" class="field-value">
                {{ frame.m0Reachability === 'down' ? 'TIMEOUT' : frame.r1Role === 'master' && frame.m0Role === 'master' ? 'UP · PENDING' : 'UP' }}
              </text>
              <text x="18" y="99" class="field-label">复制目标</text>
              <text x="142" y="99" text-anchor="end" class="field-value">{{ frame.m0Upstream?.toUpperCase() ?? '—' }}</text>
            </g>

            <g class="redis-node" :class="[`role-${frame.r1Role}`]" :transform="`translate(390 ${redisNodeTopY})`">
              <rect width="160" height="118" rx="7" />
              <g transform="translate(18 17)"><Server :size="18" /></g>
              <text x="45" y="32" class="redis-node-title">R1</text>
              <text x="142" y="31" text-anchor="end" class="redis-role">{{ roleLabel(frame.r1Role) }}</text>
              <line x1="18" y1="48" x2="142" y2="48" class="node-divider" />
              <text x="18" y="75" class="field-label">priority</text>
              <text x="142" y="75" text-anchor="end" class="field-value">100</text>
              <text x="18" y="99" class="field-label">offset</text>
              <text x="142" y="99" text-anchor="end" class="field-value">1200</text>
            </g>

            <g class="redis-node" :class="[`role-${frame.r2Role}`]" :transform="`translate(690 ${redisNodeTopY})`">
              <rect width="160" height="118" rx="7" />
              <g transform="translate(18 17)"><Server :size="18" /></g>
              <text x="45" y="32" class="redis-node-title">R2</text>
              <text x="142" y="31" text-anchor="end" class="redis-role">{{ roleLabel(frame.r2Role) }}</text>
              <line x1="18" y1="48" x2="142" y2="48" class="node-divider" />
              <text x="18" y="75" class="field-label">priority</text>
              <text x="142" y="75" text-anchor="end" class="field-value">100</text>
              <text x="18" y="99" class="field-label">offset</text>
              <text x="142" y="99" text-anchor="end" class="field-value">1160</text>
            </g>

            <g v-if="frame.event.route" class="message-path" :class="`kind-${frame.event.kind}`">
              <line
                :x1="getPoint(frame.event.route.from).x"
                :y1="getPoint(frame.event.route.from).y"
                :x2="getPoint(frame.event.route.to).x"
                :y2="getPoint(frame.event.route.to).y"
              />
              <text
                :x="(getPoint(frame.event.route.from).x + getPoint(frame.event.route.to).x) / 2"
                :y="(getPoint(frame.event.route.from).y + getPoint(frame.event.route.to).y) / 2 - 12"
                text-anchor="middle"
              >{{ frame.event.label }}</text>
            </g>

            <g v-if="frame.event.route" ref="messageDot" class="message-dot" :class="`kind-${frame.event.kind}`" aria-hidden="true">
              <circle r="10" class="message-dot-ring" />
              <circle r="4" />
            </g>

            <text x="470" :y="topologyCaptionY" text-anchor="middle" class="topology-caption">
              {{ frame.topology }}
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

      <aside class="inspector-panel inspector-panel--redis" aria-label="Sentinel 决策状态检查器">
        <div class="inspector-heading">
          <span><Activity :size="16" /> 决策状态</span>
          <span class="status-badge is-live">EPOCH {{ frame.epoch ?? '—' }}</span>
        </div>

        <div class="decision-counter">
          <span class="counter-icon counter-icon--danger"><RadioTower :size="17" /></span>
          <div><small>客观下线 · quorum ≥ 2</small><strong>{{ frame.quorumVotes }} / 2</strong></div>
        </div>
        <div class="counter-track"><span :style="{ width: `${quorumProgress}%` }" /></div>

        <div class="decision-counter">
          <span class="counter-icon counter-icon--vote"><Vote :size="17" /></span>
          <div><small>故障转移授权 · majority ≥ 3</small><strong>{{ frame.authorizationVotes }} / 5</strong></div>
        </div>
        <div class="counter-track counter-track--vote"><span :style="{ width: `${authorizationProgress}%` }" /></div>

        <div class="inspector-section-label">副本候选排序</div>
        <div class="candidate-table" role="table" aria-label="副本候选排序">
          <div class="candidate-row candidate-row--header" role="row">
            <span role="columnheader">节点</span><span role="columnheader">优先级</span><span role="columnheader">偏移量</span>
          </div>
          <div class="candidate-row" :class="{ 'is-selected': ['selected', 'promoting', 'master'].includes(frame.r1Role) }" role="row">
            <strong role="cell">R1 <Check v-if="['selected', 'promoting', 'master'].includes(frame.r1Role)" :size="14" /></strong><span role="cell">100</span><span role="cell">1200</span>
          </div>
          <div class="candidate-row" role="row">
            <strong role="cell">R2</strong><span role="cell">100</span><span role="cell">1160</span>
          </div>
        </div>

        <div class="event-message" :class="`kind-${frame.event.kind}`">
          <span class="event-pulse" />
          <div>
            <small>当前事件</small>
            <strong v-if="frame.event.route">{{ frame.event.route.from.toUpperCase() }} → {{ frame.event.route.to.toUpperCase() }}</strong>
            <strong v-else>协调者内部决策</strong>
            <code>{{ frame.event.label }}</code>
          </div>
        </div>

        <div class="protocol-note">
          <Crown :size="18" />
          <p><strong>{{ coordinatorLabel }}</strong><span>协调者负责选择并晋升副本，不是长期的集群 Leader。</span></p>
        </div>
      </aside>
    </div>
  </section>
</template>
