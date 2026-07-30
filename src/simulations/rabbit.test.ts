import { describe, expect, it } from 'vitest'
import { rabbitExchange, rabbitFrames, type RabbitFrame } from './rabbit'

function frame(id: string): RabbitFrame {
  const match = rabbitFrames.find((item) => item.id === id)
  if (!match) throw new Error(`Missing RabbitMQ frame: ${id}`)
  return match
}

describe('RabbitMQ reliability simulation', () => {
  it('models a direct exchange binding and immutable causal sequence', () => {
    expect(rabbitExchange).toEqual({
      name: 'orders.x',
      type: 'direct',
      bindingKey: 'order.created',
    })
    expect(rabbitFrames).toHaveLength(22)
    expect(new Set(rabbitFrames.map(({ id }) => id)).size).toBe(22)
    expect(Object.isFrozen(rabbitFrames)).toBe(true)
    expect(Object.isFrozen(rabbitFrames[0].publisher)).toBe(true)
  })

  it('confirms a routed persistent message after it enters the queue', () => {
    const routed = frame('m1-routed')
    const confirmed = frame('m1-confirmed')

    expect(routed.queue.ready.map(({ id }) => id)).toEqual(['m1'])
    expect(routed.queue.ready[0]).toMatchObject({ persistent: true, redelivered: false })
    expect(confirmed.publisher.confirms).toContainEqual({ messageId: 'm1', outcome: 'ack' })
  })

  it('returns an unroutable mandatory message and still confirms the publish', () => {
    const returned = frame('m2-returned')
    const confirmed = frame('m2-confirmed')

    expect(returned.publisher.returns).toContainEqual({
      messageId: 'm2',
      replyCode: 312,
      replyText: 'NO_ROUTE',
    })
    expect(returned.queue.ready.some(({ id }) => id === 'm2')).toBe(false)
    expect(confirmed.publisher.confirms).toContainEqual({ messageId: 'm2', outcome: 'ack' })
  })

  it('keeps a delivery unacked until the consumer explicitly acknowledges it', () => {
    const delivered = frame('m1-delivered')
    const failed = frame('m1-processing-failed')
    const acked = frame('m1-acked')

    expect(delivered.queue.ready).toHaveLength(0)
    expect(delivered.queue.unacked[0]).toMatchObject({ deliveryTag: 1, channel: 1 })
    expect(failed.queue.unacked).toHaveLength(1)
    expect(acked.queue.unacked).toHaveLength(0)
    expect(acked.consumer.handled).toEqual(['m1'])
  })

  it('requeues a nacked message and marks its next delivery as redelivered', () => {
    const requeued = frame('m1-nacked-requeue')
    const redelivered = frame('m1-redelivered')

    expect(requeued.queue.ready[0]).toMatchObject({ id: 'm1', redelivered: true })
    expect(redelivered.queue.unacked[0]).toMatchObject({
      deliveryTag: 2,
      channel: 1,
      message: { id: 'm1', redelivered: true },
    })
  })

  it('requeues unacked deliveries when a channel closes and resets delivery tags on reconnect', () => {
    const closed = frame('consumer-channel-closed')
    const redelivered = frame('m3-redelivered')
    const complete = frame('m3-acked')

    expect(closed.consumer.status).toBe('closed')
    expect(closed.queue.unacked).toHaveLength(0)
    expect(closed.queue.ready[0]).toMatchObject({ id: 'm3', redelivered: true })
    expect(redelivered.queue.unacked[0]).toMatchObject({ channel: 2, deliveryTag: 1 })
    expect(complete.consumer.handled).toEqual(['m1', 'm3'])
    expect(complete.queue).toMatchObject({ ready: [], unacked: [] })
  })
})
