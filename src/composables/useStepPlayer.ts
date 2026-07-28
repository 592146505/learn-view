import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

export interface StepPlayer {
  step: Ref<number>
  playing: Ref<boolean>
  speed: Ref<number>
  next: () => void
  previous: () => void
  toggle: () => void
  reset: () => void
  goTo: (value: number) => void
}

export function useStepPlayer(total: Ref<number>): StepPlayer {
  const step = ref(0)
  const playing = ref(false)
  const speed = ref(1)
  let timer: number | undefined

  const clearTimer = () => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
  }

  const pause = () => {
    playing.value = false
    clearTimer()
  }

  const advance = () => {
    if (step.value >= total.value - 1) {
      pause()
      return
    }

    step.value += 1
    if (step.value >= total.value - 1) pause()
  }

  const next = () => {
    pause()
    advance()
  }

  const previous = () => {
    pause()
    step.value = Math.max(0, step.value - 1)
  }

  const toggle = () => {
    if (playing.value) {
      pause()
      return
    }

    if (step.value >= total.value - 1) step.value = 0
    playing.value = true
  }

  const reset = () => {
    pause()
    step.value = 0
  }

  const goTo = (value: number) => {
    pause()
    step.value = Math.min(Math.max(value, 0), total.value - 1)
  }

  const schedule = () => {
    clearTimer()
    if (!playing.value) return
    timer = window.setTimeout(() => {
      timer = undefined
      advance()
      if (playing.value) schedule()
    }, 1800 / speed.value)
  }

  const handleKeydown = (event: KeyboardEvent) => {
    const target = event.target
    const isInteractive = target instanceof HTMLElement
      && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName))

    if (isInteractive || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return

    if (event.code === 'Space') {
      event.preventDefault()
      toggle()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      previous()
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      next()
    }
  }

  watch([playing, speed], schedule)
  watch(total, () => {
    if (step.value >= total.value) reset()
  })

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onBeforeUnmount(() => {
    clearTimer()
    window.removeEventListener('keydown', handleKeydown)
  })

  return { step, playing, speed, next, previous, toggle, reset, goTo }
}
