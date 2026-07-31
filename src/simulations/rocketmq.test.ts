import { describe, expect, it } from 'vitest'
import { rocketFrames, type RocketFrame } from './rocketmq'

function frame(id: string): RocketFrame {
  const match = rocketFrames.find((item) => item.id === id)
  if (!match) throw new Error(`Missing RocketMQ frame: ${id}`)
  return match
}

describe('RocketMQ transactional message simulation', () => {
  it('exports an immutable 24-step causal sequence for a transaction topic', () => {
    expect(rocketFrames).toHaveLength(24)
    expect(new Set(rocketFrames.map(({ id }) => id)).size).toBe(24)
    expect(rocketFrames[0].broker.topicType).toBe('TRANSACTION')
    expect(rocketFrames[0].producer.checkerEnabled).toBe(true)
    expect(Object.isFrozen(rocketFrames)).toBe(true)
    expect(Object.isFrozen(rocketFrames[0].broker)).toBe(true)
  })

  it('keeps a half message invisible until the second-phase commit', () => {
    const pending = frame('tx1-half-acked')
    const localCommitted = frame('tx1-local-committed')
    const ready = frame('tx1-ready')

    expect(pending.broker.halfMessages.map(({ message }) => message.id)).toEqual(['tx1'])
    expect(pending.broker.ready).toHaveLength(0)
    expect(localCommitted.broker.ready).toHaveLength(0)
    expect(ready.broker.halfMessages).toHaveLength(0)
    expect(ready.broker.ready.map(({ id }) => id)).toEqual(['tx1'])
  })

  it('delivers a normally committed transaction message', () => {
    const delivered = frame('tx1-delivered')

    expect(delivered.consumer.current?.id).toBe('tx1')
    expect(delivered.broker.ready).toHaveLength(0)
    expect(delivered.producer.localTransactions).toContainEqual({
      messageId: 'tx1',
      orderId: 'ORDER-2001',
      state: 'committed',
    })
  })

  it('removes a rolled-back half message without exposing it to the consumer', () => {
    const discarded = frame('tx2-discarded')

    expect(discarded.broker.halfMessages.some(({ message }) => message.id === 'tx2')).toBe(false)
    expect(discarded.broker.ready.some(({ id }) => id === 'tx2')).toBe(false)
    expect(discarded.broker.rolledBack).toContain('tx2')
    expect(discarded.consumer.current).toBeNull()
  })

  it('keeps an unknown transaction pending and triggers a broker check', () => {
    const lost = frame('tx3-second-ack-lost')
    const checked = frame('tx3-check-requested')

    expect(lost.broker.halfMessages.find(({ message }) => message.id === 'tx3')).toMatchObject({
      state: 'pending',
      checkCount: 0,
    })
    expect(lost.broker.ready).toHaveLength(0)
    expect(checked.broker.halfMessages.find(({ message }) => message.id === 'tx3')?.checkCount).toBe(1)
    expect(checked.event.route).toEqual({ from: 'broker', to: 'producer' })
  })

  it('commits after checking durable local state and only delivers committed messages', () => {
    const resolution = frame('tx3-check-committed')
    const ready = frame('tx3-ready')
    const delivered = frame('tx3-delivered')

    expect(resolution.producer.localTransactions.find(({ messageId }) => messageId === 'tx3')?.state).toBe('committed')
    expect(ready.broker.halfMessages).toHaveLength(0)
    expect(ready.broker.ready.map(({ id }) => id)).toEqual(['tx3'])
    expect(delivered.consumer.current?.id).toBe('tx3')
    expect(delivered.consumer.consumed).toEqual(['tx1'])
  })
})
