/** @vitest-environment jsdom */

import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStepPlayer, type StepPlayer } from './useStepPlayer'

function mountPlayer(totalSteps = 4) {
  let player: StepPlayer | undefined
  const host = defineComponent({
    setup() {
      player = useStepPlayer(ref(totalSteps))
      return () => h('div', [h('input', { 'aria-label': '测试输入框' })])
    },
  })

  const wrapper = mount(host, { attachTo: document.body })
  if (!player) throw new Error('Step player was not created')
  return { player, wrapper }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useStepPlayer keyboard controls', () => {
  it('toggles playback with Space and pauses on manual arrow steps', async () => {
    vi.useFakeTimers()
    const { player, wrapper } = mountPlayer()

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))
    await nextTick()
    expect(player.playing.value).toBe(true)

    vi.advanceTimersByTime(1800)
    await nextTick()
    expect(player.step.value).toBe(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true }))
    expect(player.step.value).toBe(2)
    expect(player.playing.value).toBe(false)

    vi.advanceTimersByTime(3600)
    expect(player.step.value).toBe(2)

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft', bubbles: true }))
    expect(player.step.value).toBe(1)
    expect(player.playing.value).toBe(false)

    wrapper.unmount()
  })

  it('does not intercept shortcuts from interactive controls', () => {
    const { player, wrapper } = mountPlayer()
    const input = wrapper.get('input')

    input.element.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true }))
    expect(player.step.value).toBe(0)
    expect(player.playing.value).toBe(false)

    wrapper.unmount()
  })
})
