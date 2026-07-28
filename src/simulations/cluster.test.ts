import { describe, expect, it } from 'vitest'
import {
  clusterFrames,
  masterConfigEpochs,
  type ClusterFrame,
  type ClusterProtocolState,
} from './cluster'

function frame(id: string) {
  const match = clusterFrames.find((item) => item.id === id)
  if (!match) throw new Error(`Missing Redis Cluster frame: ${id}`)
  return match
}

function protocolState(item: ClusterFrame): ClusterProtocolState {
  return {
    m2Reachability: item.m2Reachability,
    m2Views: item.m2Views,
    clusterStates: item.clusterStates,
    slotOwners: item.slotOwners,
    failureReports: item.failureReports,
    votes: item.votes,
    currentEpoch: item.currentEpoch,
    r2Role: item.r2Role,
    r2ConfigEpoch: item.r2ConfigEpoch,
  }
}

describe('Redis Cluster failover simulation', () => {
  it('uses unique master config epochs below the initial current epoch', () => {
    expect(masterConfigEpochs).toEqual({ m1: 5, m2: 7, m3: 6 })
    expect(new Set(Object.values(masterConfigEpochs)).size).toBe(3)
    expect(Math.max(...Object.values(masterConfigEpochs))).toBe(frame('hash-slot').currentEpoch)
    expect(frame('hash-slot').currentEpoch).toBe(7)
  })

  it('routes the hash-tagged key through M1 and then M2', () => {
    expect(frame('hash-slot').event.label).toBe('CRC16("42") mod 16384 = 8000')
    expect(frame('client-get-m1').event.route).toEqual({ from: 'client', to: 'm1' })
    expect(frame('m1-moved-m2').event.label).toBe('MOVED 8000 M2:6379')
    expect(frame('client-get-m2').event.route).toEqual({ from: 'client', to: 'm2' })
  })

  it('keeps PFAIL and FAIL local to each observer until messages are processed', () => {
    expect(frame('m1-marks-pfail').m2Views).toEqual({ m1: 'PFAIL', m3: 'OK', r2: 'OK' })
    expect(frame('m1-marks-pfail').failureReports).toBe(1)
    expect(frame('m1-gossips-pfail').m2Views).toEqual(frame('m1-marks-pfail').m2Views)
    expect(frame('m1-gossips-pfail').observer).toBe('m3')

    expect(frame('m3-marks-pfail').m2Views).toEqual({ m1: 'PFAIL', m3: 'PFAIL', r2: 'OK' })
    expect(frame('m3-reports-pfail').failureReports).toBe(1)
    expect(frame('m3-reports-pfail').m2Views.m1).toBe('PFAIL')
    expect(frame('m3-reports-pfail').observer).toBe('m1')

    expect(frame('m1-marks-fail').failureReports).toBe(2)
    expect(frame('m1-marks-fail').m2Views).toEqual({ m1: 'FAIL', m3: 'PFAIL', r2: 'OK' })
    expect(frame('m1-marks-fail').clusterStates).toEqual({ m1: 'fail', m3: 'ok', r2: 'ok' })

    expect(frame('r2-records-fail').m2Views).toEqual({ m1: 'FAIL', m3: 'PFAIL', r2: 'FAIL' })
    expect(frame('m3-records-fail').m2Views).toEqual({ m1: 'FAIL', m3: 'FAIL', r2: 'FAIL' })
    expect(frame('m3-records-fail').clusterStates).toEqual({ m1: 'fail', m3: 'fail', r2: 'fail' })
  })

  it('does not mutate protocol state while a routed message is in flight', () => {
    clusterFrames.forEach((item, index) => {
      if (!item.event.route) return
      expect(index).toBeGreaterThan(0)
      expect(protocolState(item)).toEqual(protocolState(clusterFrames[index - 1]))
    })
  })

  it('separates election epoch, ACK delivery, local counting, and promotion', () => {
    expect(frame('r2-computes-delay').currentEpoch).toBe(7)
    expect(frame('r2-computes-delay').event.label).toContain('500-999 ms')
    expect(frame('r2-bumps-epoch').currentEpoch).toBe(8)
    expect(frame('r2-bumps-epoch').r2ConfigEpoch).toBe(0)

    expect(frame('m1-acks-r2').votes).toBe(0)
    expect(frame('m1-acks-r2').event.label).not.toMatch(/\d\s*\/\s*\d/)
    expect(frame('r2-counts-m1-vote').votes).toBe(1)

    expect(frame('m3-acks-r2').votes).toBe(1)
    expect(frame('m3-acks-r2').event.label).not.toMatch(/\d\s*\/\s*\d/)
    expect(frame('r2-counts-m3-vote').votes).toBe(2)
    expect(frame('r2-counts-m3-vote').r2Role).toBe('candidate')
    expect(frame('r2-counts-m3-vote').r2ConfigEpoch).toBe(0)

    expect(frame('r2-promotes').votes).toBe(2)
    expect(frame('r2-promotes').r2Role).toBe('master')
    expect(frame('r2-promotes').r2ConfigEpoch).toBe(8)
  })

  it('uses two distinct slot-serving masters for the majority authorization', () => {
    const acknowledgements = [frame('m1-acks-r2'), frame('m3-acks-r2')]
    expect(acknowledgements.map(({ event }) => event.route?.from)).toEqual(['m1', 'm3'])
    expect(new Set(acknowledgements.map(({ event }) => event.route?.from)).size).toBe(2)
    expect(acknowledgements.every(({ event }) => event.route?.to === 'r2')).toBe(true)
  })

  it('converges local slot tables one observer at a time', () => {
    expect(frame('r2-promotes').slotOwners).toEqual({ m1: 'm2', m3: 'm2', r2: 'r2' })
    expect(frame('r2-promotes').clusterStates).toEqual({ m1: 'fail', m3: 'fail', r2: 'ok' })

    expect(frame('r2-announces-to-m1').slotOwners).toEqual(frame('r2-promotes').slotOwners)
    expect(frame('r2-announces-to-m1').observer).toBe('m1')
    expect(frame('m1-accepts-r2-owner').slotOwners).toEqual({ m1: 'r2', m3: 'm2', r2: 'r2' })
    expect(frame('m1-accepts-r2-owner').clusterStates).toEqual({ m1: 'ok', m3: 'fail', r2: 'ok' })

    expect(frame('r2-announces-to-m3').slotOwners).toEqual(frame('m1-accepts-r2-owner').slotOwners)
    expect(frame('r2-announces-to-m3').observer).toBe('m3')
    expect(frame('m3-accepts-r2-owner').slotOwners).toEqual({ m1: 'r2', m3: 'r2', r2: 'r2' })
    expect(frame('m3-accepts-r2-owner').clusterStates).toEqual({ m1: 'ok', m3: 'ok', r2: 'ok' })
  })

  it('retries the stale cached M2 address before discovering R2 through M1', () => {
    expect(frame('client-gets-stale-m2').event.route).toEqual({ from: 'client', to: 'm2' })
    expect(frame('client-m2-connection-fails').event.route).toBeNull()
    expect(frame('client-gets-m1').event.route).toEqual({ from: 'client', to: 'm1' })
    expect(frame('m1-moved-r2').event.label).toBe('MOVED 8000 R2:6379')
    expect(frame('client-gets-r2').event.route).toEqual({ from: 'client', to: 'r2' })
    expect(frame('r2-returns-result').event.route).toEqual({ from: 'r2', to: 'client' })
  })

  it('finishes with one authoritative owner in every tracked local view', () => {
    const finalFrame = frame('r2-returns-result')
    expect(new Set(Object.values(finalFrame.slotOwners))).toEqual(new Set(['r2']))
    expect(finalFrame.r2Role).toBe('master')
    expect(finalFrame.r2ConfigEpoch).toBe(8)
    expect(finalFrame.clusterStates).toEqual({ m1: 'ok', m3: 'ok', r2: 'ok' })
  })

  it('contains the complete 33-step causal sequence', () => {
    expect(clusterFrames).toHaveLength(33)
    expect(new Set(clusterFrames.map(({ id }) => id)).size).toBe(33)
    expect(clusterFrames.every(({ event }) => event.label.length > 0)).toBe(true)
    expect(frame('m1-sends-fail-r2').event.label).not.toContain('epoch')
    expect(frame('m1-sends-fail-m3').event.label).not.toContain('epoch')
    expect(frame('m1-sends-fail-r2').event.label).toContain('广播副本')
    expect(frame('m1-sends-fail-m3').event.label).toContain('广播副本')
  })
})
