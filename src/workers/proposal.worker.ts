/// <reference lib="webworker" />
import type { AppState, PlanChangeEvent } from '../types'
import { generateSchedulingProposals } from '../lib/planner'

type ProposalWorkerRequest = {
  preparedState: AppState
  baseline: AppState
  event: PlanChangeEvent
}

type ProposalWorkerResponse =
  | { ok: true; proposals: ReturnType<typeof generateSchedulingProposals> }
  | { ok: false; message: string }

self.onmessage = (message: MessageEvent<ProposalWorkerRequest>) => {
  try {
    const { preparedState, baseline, event } = message.data
    const proposals = generateSchedulingProposals(preparedState, event, { baseline })
    self.postMessage({ ok: true, proposals } satisfies ProposalWorkerResponse)
  } catch (error) {
    self.postMessage({ ok: false, message: error instanceof Error ? error.message : '方案计算失败' } satisfies ProposalWorkerResponse)
  }
}
