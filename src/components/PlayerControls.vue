<script setup lang="ts">
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from '@lucide/vue'

defineProps<{
  step: number
  total: number
  playing: boolean
  speed: number
  stepLabels?: string[]
}>()

const emit = defineEmits<{
  previous: []
  next: []
  toggle: []
  reset: []
  goTo: [step: number]
  'update:speed': [speed: number]
}>()
</script>

<template>
  <div class="player-controls" aria-label="动画播放控制">
    <div class="transport-controls">
      <button class="icon-button" type="button" aria-label="回到开始" data-tooltip="回到开始" @click="emit('reset')">
        <RotateCcw :size="17" />
      </button>
      <button class="icon-button" type="button" aria-label="上一步" data-tooltip="上一步" :disabled="step === 0" @click="emit('previous')">
        <SkipBack :size="17" fill="currentColor" />
      </button>
      <button class="icon-button icon-button--primary" type="button" :aria-label="playing ? '暂停' : '播放'" :data-tooltip="playing ? '暂停' : '播放'" @click="emit('toggle')">
        <Pause v-if="playing" :size="18" fill="currentColor" />
        <Play v-else :size="18" fill="currentColor" />
      </button>
      <button class="icon-button" type="button" aria-label="下一步" data-tooltip="下一步" :disabled="step === total - 1" @click="emit('next')">
        <SkipForward :size="17" fill="currentColor" />
      </button>
    </div>

    <div class="step-scrubber" :class="{ 'is-dense': total > 24 }" role="group" aria-label="选择步骤">
      <button
        v-for="index in total"
        :key="index"
        type="button"
        class="step-dot"
        :class="{ 'is-complete': index - 1 < step, 'is-current': index - 1 === step }"
        :aria-label="stepLabels?.[index - 1] ? `第 ${index} 步：${stepLabels[index - 1]}` : `第 ${index} 步`"
        :data-tooltip="stepLabels?.[index - 1]"
        :aria-current="index - 1 === step ? 'step' : undefined"
        @click="emit('goTo', index - 1)"
      />
    </div>

    <label class="speed-control">
      <span>速度</span>
      <select :value="speed" aria-label="播放速度" @change="emit('update:speed', Number(($event.target as HTMLSelectElement).value))">
        <option :value="0.75">0.75×</option>
        <option :value="1">1×</option>
        <option :value="1.5">1.5×</option>
        <option :value="2">2×</option>
      </select>
    </label>
  </div>
</template>
