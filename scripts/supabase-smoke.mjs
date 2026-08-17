import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const mode = (process.env.SUPABASE_SMOKE_MODE || 'public').trim().toLowerCase()
const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '')
const publishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const secretKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!['public', 'full'].includes(mode)) {
  throw new Error(`SUPABASE_SMOKE_MODE 只能是 public 或 full，当前为：${mode}`)
}
if (!supabaseUrl) throw new Error('缺少 SUPABASE_URL（或 VITE_SUPABASE_URL）')
if (!publishableKey) throw new Error('缺少 SUPABASE_PUBLISHABLE_KEY（或 VITE_SUPABASE_ANON_KEY）')
if (mode === 'full' && !secretKey) {
  throw new Error('full 模式需要 SUPABASE_SECRET_KEY（或 SUPABASE_SERVICE_ROLE_KEY），用于创建并清理隔离的临时测试账号')
}

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}

const publicClient = createClient(supabaseUrl, publishableKey, clientOptions)
const results = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function check(name, run) {
  const startedAt = Date.now()
  try {
    await run()
    const elapsed = Date.now() - startedAt
    results.push({ name, ok: true, elapsed })
    console.log(`✓ ${name} (${elapsed}ms)`)
  } catch (error) {
    const elapsed = Date.now() - startedAt
    const message = error instanceof Error ? error.message : String(error)
    results.push({ name, ok: false, elapsed, message })
    console.error(`✗ ${name} (${elapsed}ms): ${message}`)
  }
}

async function requireNoError(result, context) {
  if (result?.error) {
    const code = result.error.code ? ` [${result.error.code}]` : ''
    throw new Error(`${context}${code}: ${result.error.message || '未知错误'}`)
  }
  return result?.data
}

async function runPublicChecks() {
  await check('Auth 密码登录接口可达且能正常返回认证错误', async () => {
    const email = `study-planner-smoke-invalid-${crypto.randomUUID()}@example.invalid`
    const password = `invalid-${crypto.randomUUID()}-Aa1!`
    const { data, error } = await publicClient.auth.signInWithPassword({ email, password })
    assert(!data.session, '无效账号不应获得 session')
    assert(Boolean(error), '无效账号应得到认证错误；若没有错误，Auth 行为异常')
    const status = Number(error?.status || 0)
    assert(status === 0 || (status >= 400 && status < 500), `Auth 返回异常状态：${status || '未知'}`)
    assert(error?.name !== 'AuthRetryableFetchError', `Auth 网络请求失败：${error?.message || '未知错误'}`)
  })

  await check('Auth 注册接口可达且能正常校验无效输入', async () => {
    const { data, error } = await publicClient.auth.signUp({
      email: 'not-an-email',
      password: `invalid-${crypto.randomUUID()}-Aa1!`,
    })
    assert(!data.session, '无效注册输入不应获得 session')
    assert(Boolean(error), '无效注册输入应得到 Auth 校验错误')
    assert(error?.name !== 'AuthRetryableFetchError', `Auth 注册网络请求失败：${error?.message || '未知错误'}`)
  })

  await check('Data API 暴露 study_snapshots 且关键列完整', async () => {
    const result = await publicClient
      .from('study_snapshots')
      .select('user_id,data,client_updated_at,updated_at,revision')
      .limit(0)
    await requireNoError(result, 'study_snapshots schema 探测失败')
  })

  await check('匿名访问不能读取任何用户快照（RLS）', async () => {
    const result = await publicClient.from('study_snapshots').select('user_id').limit(1)
    const data = await requireNoError(result, '匿名 RLS 读取检查失败')
    assert(Array.isArray(data), '匿名读取返回值应为数组')
    assert(data.length === 0, `匿名角色读取到了 ${data.length} 条用户快照，RLS 可能泄漏数据`)
  })
}

async function runFullChecks() {
  const admin = createClient(supabaseUrl, secretKey, clientOptions)
  const runId = crypto.randomUUID()
  const password = `Smoke-${crypto.randomUUID()}-Aa1!`
  const emails = [1, 2].map(index => `study-planner-smoke-${index}-${runId}@example.invalid`)
  const userIds = []
  let user1
  let user2

  try {
    await check('管理员创建隔离临时测试账号', async () => {
      const first = await admin.auth.admin.createUser({ email: emails[0], password, email_confirm: true })
      await requireNoError(first, '创建测试账号 1 失败')
      const second = await admin.auth.admin.createUser({ email: emails[1], password, email_confirm: true })
      await requireNoError(second, '创建测试账号 2 失败')
      assert(first.data.user?.id, '测试账号 1 缺少 user id')
      assert(second.data.user?.id, '测试账号 2 缺少 user id')
      userIds.push(first.data.user.id, second.data.user.id)
      user1 = createClient(supabaseUrl, publishableKey, clientOptions)
      user2 = createClient(supabaseUrl, publishableKey, clientOptions)
    })

    await check('真实密码登录 + session 读取', async () => {
      assert(user1, '测试账号 1 client 未初始化')
      const signedIn = await user1.auth.signInWithPassword({ email: emails[0], password })
      const auth = await requireNoError(signedIn, '测试账号 1 登录失败')
      assert(auth.session?.user?.id === userIds[0], '登录 session user id 不一致')
      const sessionResult = await user1.auth.getSession()
      const sessionData = await requireNoError(sessionResult, '读取 session 失败')
      assert(sessionData.session?.user?.id === userIds[0], 'getSession 未返回当前登录账号')
    })

    await check('第二账号真实密码登录', async () => {
      assert(user2, '测试账号 2 client 未初始化')
      const signedIn = await user2.auth.signInWithPassword({ email: emails[1], password })
      const auth = await requireNoError(signedIn, '测试账号 2 登录失败')
      assert(auth.session?.user?.id === userIds[1], '测试账号 2 session user id 不一致')
    })

    await check('新账号云端恢复为空', async () => {
      const result = await user1
        .from('study_snapshots')
        .select('data,revision')
        .eq('user_id', userIds[0])
        .maybeSingle()
      const data = await requireNoError(result, '初始云端恢复失败')
      assert(data === null, '新测试账号不应已有 study_snapshots 数据')
    })

    await check('首次上传快照 revision=1', async () => {
      const payload = { smoke: true, runId, stage: 'initial', savedAt: new Date().toISOString() }
      const result = await user1
        .from('study_snapshots')
        .insert({
          user_id: userIds[0],
          data: payload,
          revision: 1,
          client_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('data,revision')
        .single()
      const data = await requireNoError(result, '首次上传失败')
      assert(Number(data.revision) === 1, `首次上传 revision 应为 1，实际为 ${data.revision}`)
      assert(data.data?.runId === runId, '首次上传 data 未按原样保存')
    })

    await check('同一用户重复首次 INSERT 触发唯一键冲突', async () => {
      const result = await user1
        .from('study_snapshots')
        .insert({
          user_id: userIds[0],
          data: { smoke: true, runId, stage: 'duplicate-insert' },
          revision: 1,
        })
      assert(Boolean(result.error), '重复首次 INSERT 应失败')
      assert(result.error?.code === '23505', `重复首次 INSERT 应返回 23505，实际为 ${result.error?.code || '未知'}`)
    })

    await check('从云端下载/恢复刚上传的快照', async () => {
      const result = await user1
        .from('study_snapshots')
        .select('data,revision')
        .eq('user_id', userIds[0])
        .maybeSingle()
      const data = await requireNoError(result, '云端下载失败')
      assert(data?.data?.runId === runId, '下载快照与上传 runId 不一致')
      assert(data?.data?.stage === 'initial', '下载快照内容不一致')
      assert(Number(data?.revision) === 1, '下载快照 revision 不一致')
    })

    await check('乐观并发更新 revision 1 → 2', async () => {
      const payload = { smoke: true, runId, stage: 'updated', savedAt: new Date().toISOString() }
      const result = await user1
        .from('study_snapshots')
        .update({ data: payload, revision: 2, updated_at: new Date().toISOString() })
        .eq('user_id', userIds[0])
        .eq('revision', 1)
        .select('data,revision')
        .maybeSingle()
      const data = await requireNoError(result, 'revision 更新失败')
      assert(Number(data?.revision) === 2, 'revision 未更新到 2')
      assert(data?.data?.stage === 'updated', 'revision 更新后的快照内容不一致')
    })

    await check('旧 revision 写入被拒绝为 0 行（冲突语义）', async () => {
      const result = await user1
        .from('study_snapshots')
        .update({ data: { smoke: true, runId, stage: 'stale-write' }, revision: 2 })
        .eq('user_id', userIds[0])
        .eq('revision', 1)
        .select('revision')
        .maybeSingle()
      const data = await requireNoError(result, '旧 revision 冲突检查失败')
      assert(data === null, '旧 revision 不应成功更新任何行')
    })

    await check('跨用户读取被 RLS 隔离', async () => {
      const result = await user2
        .from('study_snapshots')
        .select('data,revision')
        .eq('user_id', userIds[0])
        .maybeSingle()
      const data = await requireNoError(result, '跨用户读取检查请求失败')
      assert(data === null, '账号 2 不应读取账号 1 的快照')
    })

    await check('跨用户更新被 RLS 隔离', async () => {
      const result = await user2
        .from('study_snapshots')
        .update({ data: { smoke: true, runId, stage: 'rls-bypass' }, revision: 3 })
        .eq('user_id', userIds[0])
        .eq('revision', 2)
        .select('revision')
        .maybeSingle()
      const data = await requireNoError(result, '跨用户更新检查请求失败')
      assert(data === null, '账号 2 不应更新账号 1 的快照')

      const verify = await user1
        .from('study_snapshots')
        .select('data,revision')
        .eq('user_id', userIds[0])
        .maybeSingle()
      const verifyData = await requireNoError(verify, '跨用户更新后的完整性检查失败')
      assert(Number(verifyData?.revision) === 2, '跨用户更新改变了 revision，RLS 失效')
      assert(verifyData?.data?.stage === 'updated', '跨用户更新改变了快照内容，RLS 失效')
    })

    await check('本地登出清除当前 session', async () => {
      const signedOut = await user1.auth.signOut({ scope: 'local' })
      await requireNoError(signedOut, '测试账号 1 登出失败')
      const sessionResult = await user1.auth.getSession()
      const sessionData = await requireNoError(sessionResult, '登出后读取 session 失败')
      assert(sessionData.session === null, '登出后 session 仍存在')
    })
  } finally {
    if (userIds.length) {
      const cleanupRows = await admin.from('study_snapshots').delete().in('user_id', userIds)
      if (cleanupRows.error) console.error(`! 清理测试快照失败：${cleanupRows.error.message}`)
    }
    for (const id of userIds) {
      const cleanupUser = await admin.auth.admin.deleteUser(id)
      if (cleanupUser.error) console.error(`! 清理测试账号 ${id} 失败：${cleanupUser.error.message}`)
    }
  }
}

console.log(`Supabase smoke: mode=${mode}, url=${supabaseUrl}`)
await runPublicChecks()
if (mode === 'full') await runFullChecks()

const failed = results.filter(item => !item.ok)
console.log(`\nSupabase smoke 完成：${results.length - failed.length}/${results.length} 项通过`)
if (failed.length) {
  console.error('失败项：')
  for (const item of failed) console.error(`- ${item.name}: ${item.message}`)
  process.exitCode = 1
}
