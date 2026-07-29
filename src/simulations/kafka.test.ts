import { describe, expect, it } from 'vitest'
import {
  kafkaBrokerIds,
  kafkaFrames,
  kafkaPartitionForKey,
  kafkaTopic,
  type KafkaConsumerGroupId,
  type KafkaFrame,
  type KafkaPartitionId,
} from './kafka'

function frame(id: string): KafkaFrame {
  const match = kafkaFrames.find((item) => item.id === id)
  if (!match) throw new Error(`Missing Kafka frame: ${id}`)
  return match
}

function partition(item: KafkaFrame, id: KafkaPartitionId) {
  const match = item.partitions.find((candidate) => candidate.id === id)
  if (!match) throw new Error(`Missing Kafka partition: ${id}`)
  return match
}

function group(item: KafkaFrame, id: KafkaConsumerGroupId) {
  const match = item.groups.find((candidate) => candidate.id === id)
  if (!match) throw new Error(`Missing Kafka consumer group: ${id}`)
  return match
}

describe('Kafka multi-broker simulation', () => {
  it('starts with three brokers and three RF=3 partitions with distributed leaders', () => {
    const topology = frame('topology-ready')

    expect(kafkaBrokerIds).toEqual(['b1', 'b2', 'b3'])
    expect(kafkaTopic).toEqual({ name: 'orders', partitionCount: 3, replicationFactor: 3 })
    expect(topology.brokers).toHaveLength(3)
    expect(topology.partitions).toHaveLength(3)
    expect(topology.partitions.map(({ leader }) => leader)).toEqual(['b1', 'b2', 'b3'])
    expect(topology.partitions.every(({ replicas }) => replicas.length === 3)).toBe(true)
    expect(topology.partitions.every(({ replicas }) => replicas.filter(({ role }) => role === 'leader').length === 1)).toBe(true)
    expect(topology.partitions.every(({ replicas }) => replicas.every(({ inSync }) => inSync))).toBe(true)
  })

  it('uses Kafka-compatible key hashing to reach all three partitions', () => {
    expect(kafkaPartitionForKey('order-1001')).toBe(0)
    expect(kafkaPartitionForKey('order-1003')).toBe(1)
    expect(kafkaPartitionForKey('order-1009')).toBe(2)
    expect(kafkaPartitionForKey('order-1023')).toBe(0)
    expect(() => kafkaPartitionForKey('order-1001', 0)).toThrow(RangeError)
  })

  it('appends on each leader before followers replicate and acks only after HW advances', () => {
    const cases = [
      { key: 'order-1001', partitionId: 0 as const, leader: 'b1', followers: ['b2', 'b3'] },
      { key: 'order-1003', partitionId: 1 as const, leader: 'b2', followers: ['b3', 'b1'] },
      { key: 'order-1009', partitionId: 2 as const, leader: 'b3', followers: ['b1', 'b2'] },
    ] as const

    cases.forEach(({ key, partitionId, leader, followers }) => {
      const appended = partition(frame(`${key}-appended`), partitionId)
      expect(appended.records).toHaveLength(1)
      expect(appended.records[0]).toMatchObject({ offset: 0, key })
      expect(appended.replicas.find(({ broker }) => broker === leader)?.logEndOffset).toBe(1)
      expect(followers.map((broker) => appended.replicas.find((replica) => replica.broker === broker)?.logEndOffset)).toEqual([0, 0])
      expect(appended.highWatermark).toBe(0)

      const firstCopy = partition(frame(`${key}-replicated-${followers[0]}`), partitionId)
      expect(firstCopy.replicas.find(({ broker }) => broker === followers[0])?.logEndOffset).toBe(1)
      expect(firstCopy.replicas.find(({ broker }) => broker === followers[1])?.logEndOffset).toBe(0)
      expect(firstCopy.highWatermark).toBe(0)

      const committed = partition(frame(`${key}-hw-advanced`), partitionId)
      expect(committed.replicas.map(({ logEndOffset }) => logEndOffset)).toEqual([1, 1, 1])
      expect(committed.highWatermark).toBe(1)
      expect(frame(`${key}-acked`).producer.acknowledgements).toContainEqual({ partition: partitionId, offset: 0 })
    })
  })

  it('assigns every partition once within analytics and all partitions to the sole billing member', () => {
    const analytics = group(frame('analytics-assigned'), 'analytics')
    const analyticsAssignments = analytics.members.flatMap(({ assignments }) => assignments)
    expect(analytics.status).toBe('stable')
    expect(analytics.generation).toBe(1)
    expect(analyticsAssignments.sort()).toEqual([0, 1, 2])
    expect(new Set(analyticsAssignments).size).toBe(3)
    expect(analytics.members.find(({ id }) => id === 'analytics-c1')?.assignments).toEqual([0, 2])
    expect(analytics.members.find(({ id }) => id === 'analytics-c2')?.assignments).toEqual([1])

    const billing = group(frame('billing-assigned'), 'billing')
    expect(billing.status).toBe('stable')
    expect(billing.members).toHaveLength(1)
    expect(billing.members[0].assignments).toEqual([0, 1, 2])
  })

  it('keeps consumer position separate from committed offset and offsets isolated by group', () => {
    const fetched = frame('analytics-fetch-p0-o0')
    const analyticsAfterFetch = group(fetched, 'analytics')
    expect(analyticsAfterFetch.members.find(({ id }) => id === 'analytics-c1')?.positions[0]).toBe(1)
    expect(analyticsAfterFetch.committedOffsets[0]).toBe(0)

    const analyticsCommitted = frame('analytics-commit-p0-o1')
    expect(group(analyticsCommitted, 'analytics').committedOffsets[0]).toBe(1)
    expect(group(analyticsCommitted, 'billing').committedOffsets[0]).toBe(0)

    const billingFetched = frame('billing-fetch-p0-o0')
    expect(group(billingFetched, 'billing').members[0].positions[0]).toBe(1)
    expect(group(billingFetched, 'billing').committedOffsets[0]).toBe(0)

    const finalFrame = frame('analytics-commit-p0-o2')
    expect(group(finalFrame, 'analytics').committedOffsets).toEqual({ 0: 2, 1: 1, 2: 1 })
    expect(group(finalFrame, 'billing').committedOffsets).toEqual({ 0: 1, 1: 1, 2: 1 })
  })

  it('promotes only an in-sync P0 replica and continues safely after B1 fails', () => {
    const failed = frame('broker-b1-stops')
    expect(failed.brokers.find(({ id }) => id === 'b1')?.status).toBe('down')
    expect(partition(failed, 0).leader).toBe('b1')

    const elected = partition(frame('p0-elects-b2'), 0)
    expect(elected.leader).toBe('b2')
    expect(elected.leaderEpoch).toBe(1)
    expect(elected.replicas.filter(({ inSync }) => inSync).map(({ broker }) => broker)).toEqual(['b2', 'b3'])
    expect(elected.replicas.find(({ broker }) => broker === 'b2')).toMatchObject({
      role: 'leader',
      logEndOffset: 1,
      inSync: true,
    })

    const afterFailover = partition(frame('order-1023-hw-advanced'), 0)
    expect(afterFailover.highWatermark).toBe(2)
    expect(afterFailover.records.map(({ offset, key }) => ({ offset, key }))).toEqual([
      { offset: 0, key: 'order-1001' },
      { offset: 1, key: 'order-1023' },
    ])
    expect(afterFailover.replicas.find(({ broker }) => broker === 'b1')?.logEndOffset).toBe(1)
    expect(afterFailover.replicas.find(({ broker }) => broker === 'b2')?.logEndOffset).toBe(2)
    expect(afterFailover.replicas.find(({ broker }) => broker === 'b3')?.logEndOffset).toBe(2)
  })

  it('exports a deeply immutable 47-step causal sequence', () => {
    expect(kafkaFrames).toHaveLength(47)
    expect(new Set(kafkaFrames.map(({ id }) => id)).size).toBe(47)
    expect(kafkaFrames.every(({ event }) => event.label.length > 0)).toBe(true)
    expect(Object.isFrozen(kafkaFrames)).toBe(true)
    expect(Object.isFrozen(kafkaFrames[0])).toBe(true)
    expect(Object.isFrozen(kafkaFrames[0].partitions)).toBe(true)
    expect(Object.isFrozen(kafkaFrames[0].partitions[0].replicas)).toBe(true)
  })
})
