import fs from 'node:fs'

const css = fs.readFileSync('src/styles.css', 'utf8')
const modal = fs.readFileSync('src/components/Modal.tsx', 'utf8')
const proposal = fs.readFileSync('src/components/ProposalDialog.tsx', 'utf8')

const checks = [
  ['modal supports external footer', modal.includes('footer?: ReactNode') && modal.includes('<footer className="modal-footer">')],
  ['proposal passes actions through footer', proposal.includes('footer={footer}') && proposal.includes('proposal-footer-actions')],
  ['old sticky action block removed from proposal component', !proposal.includes('proposal-sticky-actions')],
  ['single local proposal bypasses fake selection', proposal.includes('singleLocalProposal') && proposal.includes('LocalOperationResult')],
  ['local operation heading is separated', proposal.includes('proposal-event-heading') && proposal.includes("'本次操作'")],
  ['mobile result uses two by two grid', /proposal-local-result-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(css)],
  ['mobile footer preserves safe area', /modal-mobile-fullscreen\.modal-with-footer \.modal-footer\{[^}]*safe-area-inset-bottom/.test(css)],
  ['mobile full screen override wins over modal-wide', /modal-card\.modal-wide\.modal-mobile-fullscreen\.modal-with-footer\{[^}]*height:100dvh;[^}]*max-height:100dvh/.test(css)],
  ['primary label describes the concrete operation', proposal.includes('requestedActionLabel') && proposal.includes('localActionLabel')],
]

for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) process.exitCode = 1
}
