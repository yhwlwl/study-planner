import type { AppState, Assignment, SequenceRenumberGroup } from '../types'

function sequenceDate(assignment: Assignment) {
  return assignment.scheduledDate ?? '9999-12-31'
}

function chronologicalAssignments(state: AppState, groupId: string) {
  return state.assignments
    .filter(assignment => assignment.groupId === groupId)
    .sort((left, right) => {
      const dateCompare = sequenceDate(left).localeCompare(sequenceDate(right))
      if (dateCompare !== 0) return dateCompare
      const indexCompare = left.index - right.index
      if (indexCompare !== 0) return indexCompare
      return left.id.localeCompare(right.id)
    })
}

function numberedTitle(baseTitle: string, index: number, count: number) {
  if (count <= 1) return baseTitle
  const width = Math.max(2, String(count).length)
  return `${baseTitle} ${String(index).padStart(width, '0')}`
}

export function findSequenceRenumberGroups(state: AppState, groupIds?: Iterable<string>): SequenceRenumberGroup[] {
  const requested = groupIds ? new Set(groupIds) : undefined
  const groups: SequenceRenumberGroup[] = []

  for (const group of state.taskGroups) {
    if (group.recurring) continue
    if (requested && !requested.has(group.id)) continue
    const assignments = chronologicalAssignments(state, group.id)
    if (assignments.length <= 1) continue

    const changes = assignments.flatMap((assignment, position) => {
      const nextIndex = position + 1
      if (assignment.index === nextIndex) return []
      return [{
        assignmentId: assignment.id,
        scheduledDate: assignment.scheduledDate,
        fromIndex: assignment.index,
        toIndex: nextIndex,
        fromTitle: assignment.title,
        toTitle: numberedTitle(group.title, nextIndex, assignments.length)
      }]
    })

    if (changes.length > 0) {
      groups.push({
        groupId: group.id,
        groupTitle: group.title,
        assignmentCount: assignments.length,
        changes
      })
    }
  }

  return groups
}

export function renumberTaskGroupsByDate(state: AppState, groupIds: Iterable<string>) {
  const requested = new Set(groupIds)
  for (const group of state.taskGroups) {
    if (group.recurring) continue
    if (!requested.has(group.id)) continue
    const assignments = chronologicalAssignments(state, group.id)
    for (let position = 0; position < assignments.length; position += 1) {
      const assignment = assignments[position]
      const nextIndex = position + 1
      assignment.index = nextIndex
      assignment.title = numberedTitle(group.title, nextIndex, assignments.length)
    }
  }
}
