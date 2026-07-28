import { describe, expect, it } from 'vitest'
import { redisFrames } from './redis'

function frame(id: string) {
  const match = redisFrames.find((item) => item.id === id)
  if (!match) throw new Error(`Missing Redis frame: ${id}`)
  return match
}

describe('Redis Sentinel failover simulation', () => {
  it('keeps each SDOWN decision local', () => {
    expect(frame('s1-sdown').sentinelViews).toEqual(['SDOWN', 'OK', 'OK', 'OK', 'OK'])
    expect(frame('s2-sdown').sentinelViews).toEqual(['SDOWN', 'SDOWN', 'OK', 'OK', 'OK'])
    expect(frame('s2-sdown').quorumVotes).toBe(1)
  })

  it('waits for a peer reply before marking ODOWN', () => {
    expect(frame('ask-down-state').quorumVotes).toBe(1)
    expect(frame('ask-down-state').sentinelViews[0]).toBe('SDOWN')

    const odown = frame('s1-odown')
    expect(odown.quorumVotes).toBe(2)
    expect(odown.authorizationVotes).toBe(0)
    expect(odown.leader).toBeNull()
    expect(odown.sentinelViews).toEqual(['ODOWN', 'SDOWN', 'OK', 'OK', 'OK'])
  })

  it('shows each majority vote before electing the coordinator', () => {
    expect(frame('election-start').authorizationVotes).toBe(1)
    expect(frame('election-start').leader).toBeNull()
    expect(frame('vote-s2').authorizationVotes).toBe(2)
    expect(frame('vote-s2').leader).toBeNull()
    expect(frame('vote-s3').authorizationVotes).toBe(3)
    expect(frame('vote-s3').leader).toBe('s1')
  })

  it('represents replica selection as an internal decision', () => {
    const selection = frame('select-replica')
    expect(selection.event.route).toBeNull()
    expect(selection.event.kind).toBe('decision')
    expect(selection.r1Role).toBe('selected')
    expect(selection.r2Role).toBe('candidate')
  })

  it('separates the promotion command from master confirmation', () => {
    expect(frame('promote-command').r1Role).toBe('promoting')
    expect(frame('promote-command').r1Upstream).toBeNull()
    expect(frame('promotion-confirmed').r1Role).toBe('master')
    expect(frame('promotion-confirmed').r2Upstream).toBe('m0')
  })

  it('reconfigures R2 before the recovered old master', () => {
    const r2Reconfigured = frame('reconfigure-r2')
    expect(r2Reconfigured.r2Upstream).toBe('r1')
    expect(r2Reconfigured.m0Upstream).toBeNull()

    const recovered = frame('old-master-recovers')
    expect(recovered.m0Reachability).toBe('up')
    expect(recovered.m0Role).toBe('master')
    expect(recovered.m0Upstream).toBeNull()

    const finalFrame = frame('reconfigure-old-master')
    expect(finalFrame.m0Role).toBe('replica')
    expect(finalFrame.m0Upstream).toBe('r1')
    expect(finalFrame.r2Upstream).toBe('r1')
  })

  it('contains one focused event per detailed step', () => {
    expect(redisFrames).toHaveLength(15)
    expect(redisFrames.every(({ event }) => event.label.length > 0)).toBe(true)
  })
})
