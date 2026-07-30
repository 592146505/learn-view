/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from './App.vue'

describe('App hash navigation', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/#mvcc')
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('follows browser hash navigation', async () => {
    const wrapper = shallowMount(App)

    window.location.hash = '#redis-sentinel'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await nextTick()

    expect(wrapper.get('.current-path strong').text()).toBe('Redis Sentinel')

    window.location.hash = '#redis-cluster'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await nextTick()

    expect(wrapper.get('.current-path strong').text()).toBe('Redis Cluster')

    window.location.hash = '#kafka'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await nextTick()

    expect(wrapper.get('.current-path strong').text()).toBe('Apache Kafka')

    window.location.hash = '#rabbitmq'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await nextTick()

    expect(wrapper.get('.current-path strong').text()).toBe('RabbitMQ')
    wrapper.unmount()
  })
})
