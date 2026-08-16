import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const root = path.resolve(process.argv[2] ?? 'dist')
if (!fs.existsSync(root)) throw new Error(`找不到构建目录：${root}`)

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? filesIn(target) : [target]
  })
}

const files = filesIn(root)
const relative = file => path.relative(root, file).replaceAll(path.sep, '/')
const jsFiles = files.filter(file => file.endsWith('.js'))
const entry = jsFiles.filter(file => /(?:^|\/)index-[^/]+\.js$/.test(relative(file))).sort()[0]
const stats = jsFiles.filter(file => /(?:^|\/)StatsPage-[^/]+\.js$/.test(relative(file))).sort()[0]
if (!entry || !stats) throw new Error('无法定位主入口或统计页 chunk，请检查构建产物命名。')

const precacheFiles = files.filter(file => {
  const name = relative(file)
  return /\.(js|css|html|svg|ico)$/.test(name) || /(^|\/)(pwa-192x192|pwa-512x512)\.png$/.test(name)
})
const size = file => fs.statSync(file).size
const gzipSize = file => zlib.gzipSync(fs.readFileSync(file), { level: 9 }).byteLength
const result = {
  entry: { file: relative(entry), rawBytes: size(entry), gzipBytes: gzipSize(entry) },
  stats: { file: relative(stats), rawBytes: size(stats), gzipBytes: gzipSize(stats) },
  precache: { files: precacheFiles.length, rawBytes: precacheFiles.reduce((sum, file) => sum + size(file), 0) },
  limits: { entryGzipBytes: 200 * 1024, statsGzipBytes: 100 * 1024, precacheRawBytes: 2.5 * 1024 * 1024 },
}
result.pass = result.entry.gzipBytes < result.limits.entryGzipBytes
  && result.stats.gzipBytes < result.limits.statsGzipBytes
  && result.precache.rawBytes < result.limits.precacheRawBytes
console.log(JSON.stringify(result, null, 2))
if (!result.pass) process.exit(1)
