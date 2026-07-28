<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'
import { Database, Eye, EyeOff } from '@lucide/vue'
import PlayerControls from './PlayerControls.vue'
import { useStepPlayer } from '../composables/useStepPlayer'
import {
  getReadView,
  getVisibilityTrace,
  isVersionCommitted,
  mvccFrames,
  rowVersions,
  type IsolationLevel,
  type RowVersion,
} from '../simulations/mvcc'

const isolation = ref<IsolationLevel>('rr')
const total = computed(() => mvccFrames.length)
const player = useStepPlayer(total)
const frame = computed(() => mvccFrames[player.step.value])
const currentOperation = computed(() => frame.value.operations[0])
const readView = computed(() => getReadView(frame.value, isolation.value))
const trace = computed(() => getVisibilityTrace(frame.value, isolation.value))
const visibleVersion = computed(() => trace.value.find((item) => item.visible))
const result = computed(() => currentOperation.value.showsResult ? visibleVersion.value : undefined)
const availableVersions = computed(() => rowVersions.slice(rowVersions.length - frame.value.versionCount))
const diagram = ref<SVGSVGElement | null>(null)
const diagramViewBoxHeight = ref(405)
const VERSION_NODE_HEIGHT = 176
const versionNodeY = computed(() => Math.max(171, diagramViewBoxHeight.value - VERSION_NODE_HEIGHT - 24))
const versionTitleY = computed(() => Math.max(142, versionNodeY.value - 47))
const versionLinks = computed(() => availableVersions.value.slice(0, -1).map((version, index) => {
  const nextVersion = availableVersions.value[index + 1]
  const startX = versionX(version) + 228
  const endX = versionX(nextVersion) - 8

  return {
    id: `${version.id}-${nextVersion.id}`,
    from: version.id,
    to: nextVersion.id,
    x: startX,
    y: versionNodeY.value + VERSION_NODE_HEIGHT / 2,
    length: endX - startX,
  }
}))
const timelineCursor = ref<SVGLineElement | null>(null)
const probe = ref<SVGGElement | null>(null)

const TIMELINE_START_X = 102
const TIMELINE_END_X = 884
const TIMELINE_STEP_X = 50
const timelineSteps = {
  r1Begin: 1,
  w1Begin: 2,
  w1Commit: 6,
  w2Begin: 8,
  w2Commit: 11,
  r1Commit: 13,
  r2Begin: 14,
} as const

function timelineXForStep(step: number): number {
  return TIMELINE_START_X + step * TIMELINE_STEP_X
}

const timelineSpans = {
  r1: { x: timelineXForStep(timelineSteps.r1Begin), width: timelineXForStep(timelineSteps.r1Commit) - timelineXForStep(timelineSteps.r1Begin) },
  r2: { x: timelineXForStep(timelineSteps.r2Begin), width: TIMELINE_END_X - timelineXForStep(timelineSteps.r2Begin) },
  w1: { x: timelineXForStep(timelineSteps.w1Begin), width: timelineXForStep(timelineSteps.w1Commit) - timelineXForStep(timelineSteps.w1Begin) },
  w2: { x: timelineXForStep(timelineSteps.w2Begin), width: timelineXForStep(timelineSteps.w2Commit) - timelineXForStep(timelineSteps.w2Begin) },
}

const timelineX = computed(() => timelineXForStep(player.step.value))
const timelineEvents = [
  { id: 'r1-begin', label: 'BEGIN R₁', kind: 'begin', step: timelineSteps.r1Begin, x: timelineXForStep(timelineSteps.r1Begin), y: 44, labelX: 10, anchor: 'start' },
  { id: 'r1-commit', label: 'COMMIT R₁', kind: 'commit', step: timelineSteps.r1Commit, x: timelineXForStep(timelineSteps.r1Commit), y: 44, labelX: -10, anchor: 'end' },
  { id: 'r2-begin', label: 'BEGIN R₂', kind: 'begin', step: timelineSteps.r2Begin, x: timelineXForStep(timelineSteps.r2Begin), y: 44, labelX: 10, anchor: 'start' },
  { id: 'w1-begin', label: 'BEGIN', kind: 'begin', step: timelineSteps.w1Begin, x: timelineXForStep(timelineSteps.w1Begin), y: 78, labelX: 10, anchor: 'start' },
  { id: 'w1-commit', label: 'COMMIT', kind: 'commit', step: timelineSteps.w1Commit, x: timelineXForStep(timelineSteps.w1Commit), y: 78, labelX: -10, anchor: 'end' },
  { id: 'w2-begin', label: 'BEGIN', kind: 'begin', step: timelineSteps.w2Begin, x: timelineXForStep(timelineSteps.w2Begin), y: 112, labelX: 10, anchor: 'start' },
  { id: 'w2-commit', label: 'COMMIT', kind: 'commit', step: timelineSteps.w2Commit, x: timelineXForStep(timelineSteps.w2Commit), y: 112, labelX: -10, anchor: 'end' },
] as const

function versionX(version: RowVersion): number {
  const versions = availableVersions.value
  const positions = versions.length === 1 ? [370] : versions.length === 2 ? [220, 520] : [70, 370, 670]
  return positions[versions.findIndex((item) => item.id === version.id)]
}

function decisionFor(version: RowVersion) {
  return trace.value.find((decision) => decision.version.id === version.id)
}

function decisionExpressionFor(version: RowVersion): string {
  const decision = decisionFor(version)
  const view = readView.value

  if (!decision || !view) return ''
  if (decision.rule === 'trx_id < min_trx_id') return `${version.trxId} < min_trx_id ${view.minTrxId}`
  if (decision.rule === 'trx_id >= max_trx_id') return `${version.trxId} ≥ max_trx_id ${view.maxTrxId}`
  if (decision.rule === 'trx_id ∈ active_ids') return `${version.trxId} ∈ active_ids [${view.activeIds.join(', ')}]`
  return '未命中排除规则'
}

function animateFrame() {
  nextTick(() => {
    if (timelineCursor.value) {
      gsap.to(timelineCursor.value, {
        attr: { x1: timelineX.value, x2: timelineX.value },
        duration: 0.48,
        ease: 'power2.out',
      })
    }

    const visible = result.value?.version
    if (probe.value && visible) {
      gsap.to(probe.value, {
        x: versionX(visible) + 110,
        y: versionNodeY.value - 14,
        duration: 0.62,
        ease: 'power3.inOut',
      })
    }
  })
}

let diagramResizeObserver: ResizeObserver | null = null

function syncDiagramViewBox() {
  if (!diagram.value || !diagram.value.clientWidth || !diagram.value.clientHeight) return
  diagramViewBoxHeight.value = Math.max(
    352,
    Math.round(diagram.value.clientHeight / diagram.value.clientWidth * 960),
  )
}

watch([player.step, isolation, versionNodeY], animateFrame)
onMounted(() => {
  animateFrame()
  if (!diagram.value) return

  diagramResizeObserver = new ResizeObserver(syncDiagramViewBox)
  diagramResizeObserver.observe(diagram.value)
  syncDiagramViewBox()
})
onBeforeUnmount(() => diagramResizeObserver?.disconnect())

watch(isolation, () => player.reset())
</script>

<template>
  <section class="lab" aria-labelledby="mvcc-title">
    <header class="lab-heading lab-heading--mvcc">
      <div>
        <div class="eyebrow"><Database :size="15" /> MySQL · InnoDB</div>
        <h1 id="mvcc-title">MVCC 可见性实验</h1>
        <p>观察同一条版本链如何在两种隔离级别下返回不同结果。</p>
      </div>
      <div class="segmented-control" aria-label="隔离级别">
        <button type="button" :aria-pressed="isolation === 'rr'" @click="isolation = 'rr'">
          Repeatable Read
        </button>
        <button type="button" :aria-pressed="isolation === 'rc'" @click="isolation = 'rc'">
          Read Committed
        </button>
      </div>
    </header>

    <div class="lab-layout lab-layout--single">
      <div class="stage-panel">
        <div class="stage-heading stage-heading--mvcc">
          <div>
            <span class="step-index">{{ String(player.step.value + 1).padStart(2, '0') }}</span>
            <div>
              <h2>{{ frame.title }}</h2>
              <p>{{ frame.description }}</p>
            </div>
          </div>
          <div class="transaction-operations" aria-label="当前步骤执行的事务操作">
            <div
              v-for="(operation, index) in frame.operations"
              :key="`${operation.actor}-${index}`"
              class="transaction-operation"
            >
              <span class="transaction-operation__actor" :data-actor="operation.actor">{{ operation.actor }}</span>
              <code>{{ operation.statement }}</code>
              <span v-if="operation.showsResult && result" class="transaction-operation__result">
                返回 <strong>{{ result.version.balance }}</strong>
              </span>
              <span v-else-if="operation.status" class="transaction-operation__status">{{ operation.status }}</span>
            </div>
          </div>
        </div>

        <div class="read-view-strip" :class="{ 'has-view': readView }" aria-live="polite">
          <div class="read-view-strip__identity">
            <span>当前 Read View</span>
            <strong>{{ readView?.label ?? '当前无快照' }}</strong>
          </div>

          <dl class="read-view-strip__fields">
            <div>
              <dt>active_ids</dt>
              <dd>{{ readView ? (readView.activeIds.length ? `[${readView.activeIds.join(', ')}]` : '[]') : '—' }}</dd>
            </div>
            <div>
              <dt>min_trx_id</dt>
              <dd>{{ readView?.minTrxId ?? '—' }}</dd>
            </div>
            <div>
              <dt>max_trx_id</dt>
              <dd>{{ readView?.maxTrxId ?? '—' }}</dd>
            </div>
            <div>
              <dt>isolation</dt>
              <dd>{{ readView ? isolation.toUpperCase() : '—' }}</dd>
            </div>
          </dl>

          <span class="status-badge" :class="{ 'is-live': readView }">
            {{ readView ? 'READ VIEW' : 'NO VIEW' }}
          </span>
        </div>

        <div id="mvcc-trace-summary" class="sr-only">
          <template v-if="readView">
            <span>当前 {{ readView.label }}。</span>
            <span v-for="decision in trace" :key="decision.version.id">
              {{ decision.version.id.toUpperCase() }}：{{ decision.reason }}，{{ decision.visible ? '快照可见' : '沿 undo 回退' }}。
            </span>
          </template>
          <span v-else>{{ frame.noReadViewMessage ?? '当前没有 Read View。' }}</span>
        </div>

        <div class="diagram-wrap">
          <svg
            ref="diagram"
            class="mvcc-diagram"
            :viewBox="`0 0 960 ${diagramViewBoxHeight}`"
            role="img"
            :aria-label="`${frame.title}，当前返回 ${result ? result.version.balance : '暂无结果'}`"
            aria-describedby="mvcc-trace-summary"
          >
            <defs>
              <marker id="mvcc-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0 0 L8 4 L0 8 Z" class="arrow-head" />
              </marker>
            </defs>

            <text x="48" y="18" class="svg-section-title">事务时间线</text>
            <text x="48" y="48" class="lane-label">读事务 R</text>
            <text x="48" y="82" class="lane-label">写事务 W1</text>
            <text x="48" y="116" class="lane-label">写事务 W2</text>

            <line x1="102" y1="44" x2="884" y2="44" class="timeline-line" />
            <line x1="102" y1="78" x2="884" y2="78" class="timeline-line" />
            <line x1="102" y1="112" x2="884" y2="112" class="timeline-line" />
            <rect
              :x="timelineSpans.r1.x"
              y="32"
              :width="timelineSpans.r1.width"
              height="24"
              rx="4"
              class="reader-transaction"
              :class="{ 'is-future': player.step.value < timelineSteps.r1Begin, 'is-inactive': player.step.value >= timelineSteps.r1Commit }"
            />
            <rect
              :x="timelineSpans.r2.x"
              y="32"
              :width="timelineSpans.r2.width"
              height="24"
              rx="4"
              class="reader-transaction reader-transaction--new"
              :class="{ 'is-future': player.step.value < timelineSteps.r2Begin }"
            />
            <rect
              :x="timelineSpans.w1.x"
              y="66"
              :width="timelineSpans.w1.width"
              height="24"
              rx="4"
              class="writer-transaction"
              :class="{ 'is-future': player.step.value < timelineSteps.w1Begin }"
            />
            <rect
              :x="timelineSpans.w2.x"
              y="100"
              :width="timelineSpans.w2.width"
              height="24"
              rx="4"
              class="writer-transaction writer-transaction--second"
              :class="{ 'is-future': player.step.value < timelineSteps.w2Begin }"
            />
            <text :x="timelineSpans.r1.x + 16" y="48" class="transaction-label">R₁ · SNAPSHOT TRANSACTION</text>
            <text :x="timelineSpans.w1.x + timelineSpans.w1.width / 2" y="82" text-anchor="middle" class="transaction-label">trx 101</text>
            <text :x="timelineSpans.w2.x + timelineSpans.w2.width / 2" y="116" text-anchor="middle" class="transaction-label">trx 102</text>

            <g
              v-for="event in timelineEvents"
              :key="event.id"
              class="transaction-event"
              :class="[
                `is-${event.kind}`,
                {
                  'is-future': player.step.value < event.step,
                  'is-current': player.step.value === event.step,
                  'is-complete': player.step.value > event.step,
                },
              ]"
              :transform="`translate(${event.x} ${event.y})`"
              :data-event="event.id"
            >
              <line y1="-11" y2="11" />
              <circle v-if="event.kind === 'begin'" r="5" />
              <rect v-else x="-4.5" y="-4.5" width="9" height="9" rx="1" transform="rotate(45)" />
              <text :x="event.labelX" y="-17" :text-anchor="event.anchor">{{ event.label }}</text>
            </g>

            <line ref="timelineCursor" :x1="timelineX" y1="28" :x2="timelineX" y2="132" class="timeline-cursor" />
            <circle :cx="timelineX" cy="28" r="5" class="timeline-cursor-dot" />

            <text x="48" :y="versionTitleY" class="svg-section-title">版本链 · newest → oldest</text>
            <g
              v-for="link in versionLinks"
              :key="link.id"
              class="undo-link"
              :style="{ transform: `translate(${link.x}px, ${link.y}px)` }"
              :data-from="link.from"
              :data-to="link.to"
            >
              <line x1="0" y1="0" :x2="link.length" y2="0" class="undo-line" marker-end="url(#mvcc-arrow)" />
            </g>

            <g
              v-for="version in availableVersions"
              :key="version.id"
              class="version-node"
              :class="{
                'is-visible': decisionFor(version)?.visible,
                'is-hidden': decisionFor(version)?.visible === false,
              }"
              :style="{ transform: `translate(${versionX(version)}px, ${versionNodeY}px)` }"
              :data-version="version.id"
            >
              <rect width="220" height="176" rx="7" />
              <text x="18" y="28" class="version-id">{{ version.id.toUpperCase() }}</text>
              <text x="202" y="28" text-anchor="end" class="commit-label">
                {{ isVersionCommitted(version, player.step.value) ? 'COMMITTED' : 'ACTIVE' }}
              </text>
              <line x1="18" y1="47" x2="202" y2="47" class="node-divider" />
              <text x="18" y="80" class="field-label">balance</text>
              <text x="202" y="80" text-anchor="end" class="field-value">{{ version.balance }}</text>
              <text x="18" y="113" class="field-label">trx_id</text>
              <text x="202" y="113" text-anchor="end" class="field-value">{{ version.trxId }}</text>
              <g v-if="decisionFor(version)" transform="translate(18 130)">
                <Eye v-if="decisionFor(version)?.visible" :size="15" />
                <EyeOff v-else :size="15" />
                <text x="22" y="11" class="decision-label">{{ decisionFor(version)?.visible ? '快照可见' : '沿 undo 回退' }}</text>
                <text x="0" y="28" class="decision-rule">{{ decisionExpressionFor(version) }}</text>
              </g>
            </g>

            <g v-if="result" ref="probe" class="version-probe" aria-hidden="true">
              <circle r="9" />
              <circle r="3" />
            </g>
          </svg>
        </div>

        <PlayerControls
          :step="player.step.value"
          :total="total"
          :playing="player.playing.value"
          :speed="player.speed.value"
          @previous="player.previous"
          @next="player.next"
          @toggle="player.toggle"
          @reset="player.reset"
          @go-to="player.goTo"
          @update:speed="player.speed.value = $event"
        />
      </div>

    </div>
  </section>
</template>
