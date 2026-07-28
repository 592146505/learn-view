import { describe, expect, it } from 'vitest'
import { evaluateVisibility, getReadView, getVisibilityTrace, isVersionCommitted, mvccFrames, rowVersions } from './mvcc'

function frameById(id: string) {
  const frame = mvccFrames.find((item) => item.id === id)
  if (!frame) throw new Error(`Missing MVCC frame: ${id}`)
  return frame
}

describe('MVCC visibility simulation', () => {
  it('executes exactly one statement in every frame', () => {
    expect(mvccFrames).toHaveLength(16)
    expect(mvccFrames.every(({ operations }) => operations.length === 1)).toBe(true)
  })

  it('gives each writer its own BEGIN step before UPDATE', () => {
    expect(frameById('w1-begins').operations[0]).toEqual(expect.objectContaining({ actor: 'W1', statement: 'BEGIN;' }))
    expect(frameById('w1-updates').operations[0]).toEqual(expect.objectContaining({ actor: 'W1', statement: expect.stringContaining('UPDATE account') }))
    expect(frameById('w2-begins').operations[0]).toEqual(expect.objectContaining({ actor: 'W2', statement: 'BEGIN;' }))
    expect(frameById('w2-updates').operations[0]).toEqual(expect.objectContaining({ actor: 'W2', statement: expect.stringContaining('UPDATE account') }))
  })

  it('does not create a Read View for a plain BEGIN or UPDATE', () => {
    expect(getReadView(frameById('reader-begins'), 'rr')).toBeNull()
    expect(getReadView(frameById('reader-begins'), 'rc')).toBeNull()
    expect(getReadView(frameById('w1-updates'), 'rr')).toBeNull()
    expect(getReadView(frameById('w1-updates'), 'rc')).toBeNull()
  })

  it('captures W1 in active_ids on the first consistent read', () => {
    expect(getReadView(frameById('first-read'), 'rr')?.activeIds).toEqual([101])
    expect(getReadView(frameById('first-read'), 'rc')?.activeIds).toEqual([101])
  })

  it('puts W1 COMMIT and the following R1 SELECT in separate frames', () => {
    expect(frameById('w1-committed').operations[0]).toEqual(expect.objectContaining({ actor: 'W1', statement: 'COMMIT;' }))
    expect(frameById('after-w1-commit').operations[0]).toEqual(expect.objectContaining({ actor: 'R1', statement: expect.stringContaining('SELECT balance') }))
  })

  it('keeps trx 101 invisible to the original repeatable-read snapshot', () => {
    const view = getReadView(frameById('after-w1-commit'), 'rr')
    expect(view).not.toBeNull()

    const decision = evaluateVisibility(rowVersions[1], view!)
    expect(decision.visible).toBe(false)
    expect(decision.rule).toBe('trx_id ∈ active_ids')
    expect(view?.activeIds).toEqual([101])
  })

  it('lets read-committed observe W1 on the SELECT after it commits', () => {
    const trace = getVisibilityTrace(frameById('after-w1-commit'), 'rc')
    expect(trace.map(({ version }) => version.id)).toEqual(['v1'])
    expect(trace[0].visible).toBe(true)
    expect(trace[0].version.balance).toBe(120)
  })

  it('walks past active W2 and returns different versions for RC and RR', () => {
    const rcTrace = getVisibilityTrace(frameById('w2-active-read'), 'rc')
    const rrTrace = getVisibilityTrace(frameById('w2-active-read'), 'rr')

    expect(rcTrace.map(({ version, visible }) => [version.id, visible])).toEqual([
      ['v2', false],
      ['v1', true],
    ])
    expect(rrTrace.map(({ version, visible }) => [version.id, visible])).toEqual([
      ['v2', false],
      ['v1', false],
      ['v0', true],
    ])
  })

  it('marks versions committed only at their dedicated COMMIT frames', () => {
    const w1CommitIndex = mvccFrames.indexOf(frameById('w1-committed'))
    const w2CommitIndex = mvccFrames.indexOf(frameById('w2-committed'))

    expect(isVersionCommitted(rowVersions[1], w1CommitIndex - 1)).toBe(false)
    expect(isVersionCommitted(rowVersions[1], w1CommitIndex)).toBe(true)
    expect(isVersionCommitted(rowVersions[0], w2CommitIndex - 1)).toBe(false)
    expect(isVersionCommitted(rowVersions[0], w2CommitIndex)).toBe(true)
  })

  it('makes the newest committed version visible to the new reader', () => {
    expect(getVisibilityTrace(frameById('new-reader-selects'), 'rr')[0].version.id).toBe('v2')
    expect(getVisibilityTrace(frameById('new-reader-selects'), 'rc')[0].version.id).toBe('v2')
  })
})
