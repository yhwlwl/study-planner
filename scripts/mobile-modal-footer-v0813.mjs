import fs from 'node:fs'

const css = fs.readFileSync('src/styles.css', 'utf8')
const modal = fs.readFileSync('src/components/Modal.tsx', 'utf8')
const sources = [
  'src/components/AdjustmentIntentDialog.tsx',
  'src/components/SingleTaskDialog.tsx',
  'src/components/TaskGroupDialog.tsx',
  'src/components/GoalsPage.tsx',
  'src/components/CalendarConstraintManager.tsx',
  'src/components/AssignmentGroupChangeDialog.tsx',
  'src/App.tsx',
].map(path => fs.readFileSync(path, 'utf8')).join('\n')

const checks = [
  ['modal extracts trailing action rows', modal.includes('splitTrailingModalActions') && modal.includes("className.split(/\\s+/).includes('modal-actions')")],
  ['extracted actions become the real footer', modal.includes('effectiveFooter = footer ?? extracted.actions') && modal.includes("effectiveFooter ? 'modal-with-footer' : ''")],
  ['modal card uses header body footer flex architecture', /\.modal-card\{[\s\S]*?display:flex;[\s\S]*?flex-direction:column;[\s\S]*?overflow:hidden;/.test(css)],
  ['modal body is the only scrolling region', /\.modal-body\{[\s\S]*?min-height:0;[\s\S]*?overflow-y:auto;/.test(css)],
  ['footer neutralizes legacy sticky action styles', /\.modal-footer \.modal-actions,[\s\S]*?position:static!important;/.test(css)],
  ['mobile footer owns bottom safe area', /modal-card\.modal-with-footer \.modal-footer\{[\s\S]*?safe-area-inset-bottom/.test(css)],
  ['two mobile actions share one compact row', /modal-footer \.modal-actions\{[\s\S]*?grid-template-columns:minmax\(96px,\.38fr\) minmax\(0,1fr\)/.test(css)],
  ['three mobile actions place the main action on its own row', /last-child:nth-child\(3\)\{[\s\S]*?grid-column:1\/-1/.test(css)],
  ['affected dialogs still expose semantic action rows', (sources.match(/className="modal-actions/g) ?? []).length >= 8],
  ['full screen modal fills the dynamic viewport', /modal-card\.modal-mobile-fullscreen\{[\s\S]*?height:100dvh!important;[\s\S]*?max-height:100dvh!important;/.test(css)],
]

for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) process.exitCode = 1
}
