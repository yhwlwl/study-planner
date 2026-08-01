import fs from 'node:fs'
const css = fs.readFileSync('src/styles.css','utf8')
const review = fs.readFileSync('src/components/ReviewDialog.tsx','utf8')
const checks = [
  ['mobile fix exists', css.includes('v0.8.11 — mobile review decision card regression fix')],
  ['mobile rule is after desktop two-column rule', css.lastIndexOf('.review-modal .review-task-decision') > css.lastIndexOf('grid-template-columns:minmax(0,1fr) minmax(280px,380px)')],
  ['mobile card uses vertical flex', /\.review-modal \.review-task-decision\{[\s\S]*?display:flex;[\s\S]*?flex-direction:column;/.test(css)],
  ['mobile select constrained', /\.review-modal \.review-carry-choice select\{[\s\S]*?max-width:100%;/.test(css)],
  ['mobile title has flexible text column', /grid-template-columns:auto minmax\(0,1fr\)/.test(css)],
  ['shorter mobile label', review.includes('接下来怎么安排')],
]
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) process.exitCode = 1
}
