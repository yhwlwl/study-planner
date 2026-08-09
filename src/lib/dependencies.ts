export interface DependencyNode {
  id: string
  title: string
  prerequisiteGroupIds?: string[]
}

/** Returns each dependency cycle once, including the repeated start node at the end. */
export function detectDependencyCycles(nodes: DependencyNode[]): string[][] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const cycles: string[][] = []
  const signatures = new Set<string>()

  const visit = (id: string) => {
    const status = state.get(id) ?? 0
    if (status === 2) return
    if (status === 1) {
      const start = stack.indexOf(id)
      const cycle = [...stack.slice(Math.max(0, start)), id]
      const core = cycle.slice(0, -1)
      const rotations = core.map((_, index) => [...core.slice(index), ...core.slice(0, index)].join('|'))
      const signature = rotations.sort()[0] ?? id
      if (!signatures.has(signature)) { signatures.add(signature); cycles.push(cycle) }
      return
    }
    state.set(id, 1)
    stack.push(id)
    for (const dependencyId of byId.get(id)?.prerequisiteGroupIds ?? []) if (byId.has(dependencyId)) visit(dependencyId)
    stack.pop()
    state.set(id, 2)
  }
  nodes.forEach(node => visit(node.id))
  return cycles
}

export function dependencyCycleLabels(nodes: DependencyNode[]) {
  const byId = new Map(nodes.map(node => [node.id, node.title]))
  return detectDependencyCycles(nodes).map(cycle => cycle.map(id => byId.get(id) ?? id).join(' → '))
}
