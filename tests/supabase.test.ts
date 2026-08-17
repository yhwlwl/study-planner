import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBlankState } from '../src/lib/seed'

const mocked = vi.hoisted(() => {
  const auth = {
    getSession: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    resend: vi.fn(),
    signOut: vi.fn(),
  }
  const client = { auth, from: vi.fn() }
  return { auth, client, createClient: vi.fn(() => client) }
})

const analytics = vi.hoisted(() => ({
  recordAnalyticsEvent: vi.fn(),
  recordSignupConfirmedIfPending: vi.fn(),
  rememberPendingSignup: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: mocked.createClient }))
vi.mock('../src/lib/analytics', () => analytics)

async function loadModule() {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-publishable-key')
  return import('../src/lib/supabase')
}

function chainWithMaybeSingle(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.eq = vi.fn(() => chain)
  chain.select = vi.fn(() => chain)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  return chain
}

beforeEach(() => {
  for (const fn of Object.values(mocked.auth)) fn.mockReset()
  mocked.client.from.mockReset()
  mocked.createClient.mockClear()
  for (const fn of Object.values(analytics)) fn.mockReset()
})

afterEach(() => vi.unstubAllEnvs())

describe('Supabase Auth 包装接口', () => {
  it('登录、读取 session、重发确认邮件和登出均透传 Supabase 错误/结果', async () => {
    const session = { user: { id: 'user-1', email: 'user@example.com' } }
    mocked.auth.signInWithPassword.mockResolvedValue({ data: { session }, error: null })
    mocked.auth.getSession.mockResolvedValue({ data: { session }, error: null })
    mocked.auth.resend.mockResolvedValue({ error: null })
    mocked.auth.signOut.mockResolvedValue({ error: null })

    const api = await loadModule()
    expect(await api.signIn('user@example.com', 'password')).toEqual(session)
    expect(await api.getSession()).toEqual(session)
    await expect(api.resendSignupConfirmation('user@example.com')).resolves.toBeUndefined()
    await expect(api.signOut()).resolves.toBeUndefined()

    expect(mocked.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'user@example.com', password: 'password' })
    expect(mocked.auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'user@example.com' })
    expect(mocked.auth.signOut).toHaveBeenCalledTimes(1)
  })

  it('注册成功返回 session，并记录待确认账号', async () => {
    const session = { user: { id: 'user-2', email: 'new@example.com' } }
    mocked.auth.signUp.mockResolvedValue({ data: { user: session.user, session }, error: null })
    const api = await loadModule()

    expect(await api.signUp('new@example.com', 'password')).toEqual(session)
    expect(mocked.auth.signUp).toHaveBeenCalledWith({ email: 'new@example.com', password: 'password' })
    expect(analytics.rememberPendingSignup).toHaveBeenCalledWith('new@example.com', 'user-2')
    expect(analytics.recordSignupConfirmedIfPending).toHaveBeenCalledWith('user-2', 'new@example.com')
  })

  it('登录失败时抛出 Supabase Auth 错误', async () => {
    const error = new Error('Invalid login credentials')
    mocked.auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error })
    const api = await loadModule()
    await expect(api.signIn('bad@example.com', 'wrong')).rejects.toBe(error)
  })
})

describe('Supabase 云端快照包装接口', () => {
  it('识别 PostgREST/数据库缺少 revision 列的错误', async () => {
    const api = await loadModule()
    expect(api.isMissingCloudRevisionColumn({ code: '42703', message: 'column revision does not exist' })).toBe(true)
    expect(api.isMissingCloudRevisionColumn({ code: 'PGRST204', message: "Could not find the 'revision' column" })).toBe(true)
    expect(api.isMissingCloudRevisionColumn({ code: '42501', message: 'permission denied' })).toBe(false)
  })

  it('按 revision 下载并校验云端快照', async () => {
    const state = buildBlankState()
    const chain = chainWithMaybeSingle({ data: { data: state, revision: 7 }, error: null })
    mocked.client.from.mockReturnValue({ select: vi.fn(() => chain) })
    const api = await loadModule()

    const snapshot = await api.downloadSnapshot('user-1')
    expect(snapshot?.revision).toBe(7)
    expect(snapshot?.state.schemaVersion).toBe(state.schemaVersion)
  })

  it('revision 列尚未迁移时自动回退旧版下载协议', async () => {
    const state = buildBlankState()
    const broken = chainWithMaybeSingle({ data: null, error: { code: '42703', message: 'column revision does not exist' } })
    const legacy = chainWithMaybeSingle({ data: { data: state }, error: null })
    mocked.client.from
      .mockReturnValueOnce({ select: vi.fn(() => broken) })
      .mockReturnValueOnce({ select: vi.fn(() => legacy) })
    const api = await loadModule()

    const snapshot = await api.downloadSnapshot('user-1')
    expect(snapshot?.revision).toBe(1)
    expect(mocked.client.from).toHaveBeenCalledTimes(2)
  })

  it('首次上传写入 revision=1', async () => {
    const state = buildBlankState()
    const insert = vi.fn().mockResolvedValue({ error: null })
    mocked.client.from.mockReturnValue({ insert })
    const api = await loadModule()

    const result = await api.uploadSnapshot(state, 'user-1')
    expect(result.revision).toBe(1)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1', revision: 1 }))
  })

  it('已有快照按 expected revision 乐观并发更新', async () => {
    const state = buildBlankState()
    const chain = chainWithMaybeSingle({ data: { revision: 4 }, error: null })
    const update = vi.fn(() => chain)
    mocked.client.from.mockReturnValue({ update })
    const api = await loadModule()

    const result = await api.uploadSnapshot(state, 'user-1', 3)
    expect(result.revision).toBe(4)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }))
    expect(chain.eq).toHaveBeenCalledWith('revision', 3)
  })

  it('旧 revision 更新 0 行时抛出 CloudRevisionConflictError', async () => {
    const state = buildBlankState()
    const chain = chainWithMaybeSingle({ data: null, error: null })
    mocked.client.from.mockReturnValue({ update: vi.fn(() => chain) })
    const api = await loadModule()

    await expect(api.uploadSnapshot(state, 'user-1', 2)).rejects.toMatchObject({
      name: 'CloudRevisionConflictError',
      expectedRevision: 2,
    })
  })

  it('revision 列缺失时上传自动退回旧版 upsert', async () => {
    const state = buildBlankState()
    const updateChain = chainWithMaybeSingle({ data: null, error: { code: 'PGRST204', message: "Could not find the 'revision' column" } })
    const upsert = vi.fn().mockResolvedValue({ error: null })
    mocked.client.from
      .mockReturnValueOnce({ update: vi.fn(() => updateChain) })
      .mockReturnValueOnce({ upsert })
    const api = await loadModule()

    const result = await api.uploadSnapshot(state, 'user-1', 5)
    expect(result.revision).toBe(6)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }), { onConflict: 'user_id' })
  })
})
