import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { detectDependencyCycles } from '../src/lib/dependencies'

describe('dependency safety net', () => {
  it('detects direct and indirect cycles', () => {
    expect(detectDependencyCycles([{ id: 'a', title: 'A', prerequisiteGroupIds: ['b'] }, { id: 'b', title: 'B', prerequisiteGroupIds: ['a'] }])).toHaveLength(1)
    expect(detectDependencyCycles([{ id: 'a', title: 'A', prerequisiteGroupIds: ['b'] }, { id: 'b', title: 'B', prerequisiteGroupIds: ['c'] }, { id: 'c', title: 'C', prerequisiteGroupIds: ['a'] }])).toHaveLength(1)
  })

  it('never reports a cycle for edges pointing backward in a topological order', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 30 }), count => {
      const nodes = Array.from({ length: count }, (_, index) => ({ id: String(index), title: String(index), prerequisiteGroupIds: index === 0 ? [] : [String(Math.floor(index / 2))] }))
      expect(detectDependencyCycles(nodes)).toEqual([])
    }))
  })
})
