// React and the SDK are provided by the host's import map; no separate frontend build.
import { createContext, createElement as h, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { SchemaForm, usePluginContext, usePluginStatus } from '@luckylillia/plugin-sdk/webui'

const endpoint = '/api/aiimgdetector/synthid'
const states = new Set(['logged-out', 'opening', 'awaiting-login', 'capturing', 'ready', 'error'])
const credentialKeys = ['refreshToken', 'pushFilename', 'bgToken']
const SynthIdEditorContext = createContext(null)
const emptyCredentials = value => credentialKeys.every(key => !String(value?.[key] ?? '').trim())
const line = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }
const muted = { fontSize: 13, lineHeight: 1.6, margin: 0, overflowWrap: 'anywhere' }
const errorStyle = { ...muted, color: 'rgb(239 68 68)' }

function inactiveMessage(plugin) {
  if (!plugin) return '正在读取插件状态…'
  if (plugin.disabled) return '启用 AI 图片检测插件后即可登录 SynthID。'
  if (plugin.state === 'loading') return '插件正在启动，稍后即可登录 SynthID。'
  if (plugin.state === 'pending') return '插件正在等待依赖服务，请先启用所需服务。'
  if (plugin.state === 'failed') return '插件启动失败，请在插件列表查看错误并重新加载。'
  return '插件尚未运行，请在插件列表检查状态。'
}

function accountTitle(status) {
  if (!status) return '正在读取登录状态…'
  switch (status.state) {
    case 'ready': return status.account ? `已登录 · ${status.account}` : '已登录'
    case 'opening': return '正在打开登录浏览器…'
    case 'awaiting-login': return '等待你在浏览器中完成登录'
    case 'capturing': return '已登录，正在获取检测凭证…'
    case 'error': return status.account ? '已登录，凭证获取失败' : '登录需要处理'
    default: return '尚未登录'
  }
}

function SynthIdAccount({ credentials, onCredentials }) {
  const ctx = usePluginContext()
  const plugin = usePluginStatus()
  const active = !!plugin && !plugin.disabled && plugin.state === 'active'
  const [status, setStatus] = useState(null)
  const [request, setRequest] = useState(null)
  const [error, setError] = useState('')
  const [filled, setFilled] = useState(false)
  const controller = useRef(null)
  const latest = useRef({ credentials, onCredentials })
  latest.current = { credentials, onCredentials }
  // Only an initially blank form can restore a saved session automatically.
  // Once credentials are edited or filled, later polls must not replace them.
  const restoreAllowed = useRef(emptyCredentials(credentials))
  if (!emptyCredentials(credentials)) restoreAllowed.current = false
  const loginAttempt = useRef(null)
  const lastAppliedRevision = useRef(null)
  const currentStatus = useRef(null)

  useEffect(() => {
    setStatus(null)
    setError('')
    setRequest(null)
    if (!active) return

    // Each request schedules the next poll after it settles. Actions use the same
    // lock, so an old status response cannot overwrite a login/cancel/logout result.
    let disposed = false
    let pending = false
    let timer
    const fillCredentials = async next => {
      const revision = next.credentialRevision
      if (next.state !== 'ready' || typeof revision !== 'string' || !revision || revision === lastAppliedRevision.current) return
      const fromLogin = loginAttempt.current && revision !== loginAttempt.current.previousRevision
      const fromRestore = restoreAllowed.current && emptyCredentials(latest.current.credentials)
      if (!fromLogin && !fromRestore) return
      setRequest('credentials')
      const result = await ctx.api(`${endpoint}/credentials`, { method: 'POST', body: { revision } })
      if (disposed) return
      if (result?.revision !== revision || !credentialKeys.every(key => typeof result.credentials?.[key] === 'string' && result.credentials[key].trim())) {
        throw new Error('未能取得完整登录凭证，请重新登录 SynthID。')
      }
      // An edit made while restoring was in flight wins over the old session.
      if (!fromLogin && (!restoreAllowed.current || !emptyCredentials(latest.current.credentials))) return
      restoreAllowed.current = false
      loginAttempt.current = null
      lastAppliedRevision.current = revision
      latest.current.onCredentials(Object.fromEntries(credentialKeys.map(key => [key, result.credentials[key]])))
      setFilled(true)
    }
    const run = async action => {
      if (disposed || pending) return
      pending = true
      clearTimeout(timer)
      if (action === 'login') {
        loginAttempt.current = { previousRevision: currentStatus.current?.credentialRevision }
        restoreAllowed.current = false
        setFilled(false)
      } else if (action === 'cancel' || action === 'logout') {
        loginAttempt.current = null
        restoreAllowed.current = false
      }
      setRequest(action)
      try {
        const next = await ctx.api(`${endpoint}/${action}`, action === 'status' ? undefined : { method: 'POST' })
        if (disposed) return
        if (!next || !states.has(next.state)) throw new Error('登录服务返回了无法识别的状态，请重新加载插件。')
        const safeStatus = {
          state: next.state,
          account: typeof next.account === 'string' ? next.account : undefined,
          message: typeof next.message === 'string' ? next.message : undefined,
          credentialRevision: typeof next.credentialRevision === 'string' ? next.credentialRevision : undefined,
        }
        currentStatus.current = safeStatus
        setStatus(safeStatus)
        if (next.state === 'error') loginAttempt.current = null
        await fillCredentials(safeStatus)
        if (disposed) return
        setError('')
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : '请求失败，请稍后重试。')
      } finally {
        pending = false
        if (!disposed) {
          setRequest(null)
          timer = setTimeout(() => { void run('status') }, 5000)
        }
      }
    }
    const current = { run }
    controller.current = current
    void run('status')
    return () => {
      disposed = true
      clearTimeout(timer)
      loginAttempt.current = null
      if (controller.current === current) controller.current = null
    }
  }, [ctx, active])

  const act = action => { void controller.current?.run(action) }
  const loggingIn = ['opening', 'awaiting-login', 'capturing'].includes(status?.state)
  const busy = !!request
  const operationLabel = request === 'login' ? '正在启动登录…'
    : request === 'cancel' ? '正在取消登录…'
      : request === 'logout' ? '正在清除会话…'
        : request === 'credentials' ? '正在填入凭证…' : ''

  return h('section', { className: 'bg-theme-item', 'aria-label': 'SynthID 浏览器登录',
    style: { padding: 16, borderRadius: 12, display: 'grid', gap: 10, minWidth: 0 } },
    h('div', { style: { ...line, justifyContent: 'space-between' } },
      h('span', { className: 'text-sm font-medium text-theme' }, 'SynthID 浏览器登录'),
      active && h('span', { className: 'text-theme-secondary', role: 'status', 'aria-live': 'polite', style: muted },
        operationLabel || (error ? '暂时无法连接登录服务' : accountTitle(status))),
    ),
    h('p', { className: 'text-theme-muted', style: muted },
      '登录浏览器和检测请求自动使用 Bot「代理」插件的设置。'),
    !active
      ? h('p', { className: 'text-theme-muted', style: muted }, inactiveMessage(plugin))
      : h('div', { style: { display: 'grid', gap: 10 } },
        status?.message && !error && h('p', { className: 'text-theme-secondary',
          style: status.state === 'error' ? errorStyle : muted }, status.message),
        error && h('p', { role: 'alert', style: errorStyle }, error),
        h('p', { className: 'text-theme-muted', style: muted },
          '完成 Google 登录后，插件会自动使用内置测试图获取凭证并填入下方，无需自行选择图片。也可以直接手动填写已有凭证。'),
        filled && h('p', { className: 'text-theme-secondary', role: 'status', style: muted },
          '凭证已自动填入，请点击弹窗底部「保存」。'),
        status?.state === 'ready' && h('p', { className: 'text-theme-muted', style: muted },
          '登录窗口会保留供后续检测使用，保存凭证不会关闭它。清除会话不会删除下方凭证，但清除后需重新登录并保存自动填写的凭证。'),
        h('div', { style: line },
          !error && status && !loggingIn && h('button', {
            type: 'button', className: 'btn-primary', disabled: busy, onClick: () => act('login'),
          }, request === 'login' ? '正在启动登录…' : status.account ? '重新获取凭证' : status.state === 'error' ? '重新登录 SynthID' : '登录 SynthID'),
          !error && loggingIn && h('button', {
            type: 'button', className: 'btn-glass', disabled: busy, onClick: () => act('cancel'),
          }, request === 'cancel' ? '正在取消…' : '取消登录'),
          !error && !loggingIn && (status?.state === 'ready' || status?.account) && h('button', {
            type: 'button', className: 'btn-glass', disabled: busy, onClick: () => act('logout'),
          }, request === 'logout' ? '正在清除…' : '清除浏览器会话'),
          error && h('button', { type: 'button', className: 'btn-glass', disabled: busy, onClick: () => act('status') },
            busy ? '正在重试…' : '重试'),
        ),
      ),
  )
}

function CredentialHelp() {
  const code = text => h('code', { style: { fontSize: 'inherit', overflowWrap: 'anywhere' } }, text)
  return h('section', { className: 'bg-theme-item', 'aria-label': 'SynthID 手动凭证说明',
    style: { padding: 16, borderRadius: 12, display: 'grid', gap: 10, minWidth: 0 } },
    h('p', { className: 'text-theme-secondary', style: muted },
      '浏览器登录会自动填写这三项，保存后使用该会话为每张图片完成网页校验。也可从自己的浏览器复制凭证，手动填写不要求 Bot 安装浏览器。填写或修改后，点击弹窗底部「保存」。'),
    h('details', null,
      h('summary', { className: 'text-sm font-medium text-theme', style: { cursor: 'pointer' } }, '如何获取凭证（在自己的浏览器中操作）'),
      h('ol', { className: 'text-theme-secondary', style: { ...muted, marginTop: 12, paddingLeft: 22, listStyle: 'decimal', display: 'grid', gap: 10 } },
        h('li', null, '用 Chrome 或 Edge 打开 ',
          h('a', { href: 'https://synthid.com/image-detection', target: '_blank', rel: 'noopener noreferrer', style: { textDecoration: 'underline' } }, 'synthid.com/image-detection'),
          '，完成 Google 登录与首次使用提示。'),
        h('li', null, '按 F12 打开开发者工具。在 Network（网络）中勾选 Preserve log（保留日志），再上传一张测试图片，等待检测完成。后两项必须来自这一次检测。'),
        h('li', null, '获取「登录凭据」：切到 Application（应用）→ IndexedDB → ', code('firebaseLocalStorageDb'), ' → ', code('firebaseLocalStorage'),
          '，展开当前账号的 ', code('firebase:authUser:…'), ' 记录，在 value 中复制 ', code('stsTokenManager.refreshToken'),
          ' 的完整值，不带外围引号。没有该数据库时，确认已登录，再刷新开发者工具中的数据。'),
        h('li', null, '获取「上传标识」：回到 Network，找到上传图片的 ', code('content-push'),
          ' 请求，在 Headers（标头）→ Request Headers（请求标头）中复制 ', code('Push-Filename'), '，格式为 ', code('users/账号ID/files/文件ID'),
          '。也可筛选 ', code('TZRKo'), '，选择 ', code('batchexecute?rpcids=TZRKo'), ' 的 POST 请求，在 Payload（负载）→ Form Data（表单数据）→ ', code('f.req'),
          ' 中找到同一标识。它是网站的上传标识，不是电脑上的文件夹，不能自行编写。'),
        h('li', null, '获取「网页校验凭据」：打开同一次检测的 ', code('batchexecute?rpcids=TZRKo'),
          ' 请求，在 Request Headers 中复制 ', code('X-Goog-Ext-525006476-Jspb'),
          ' 的完整 JSON 数组（推荐），也可只复制数组第 6 项（索引 5，以 ', code('!'),
          ' 开头的字符串）。看不到时展开请求标头，或切换「查看源代码」。'),
      ),
      h('p', { className: 'text-theme-muted', style: { ...muted, marginTop: 12 } },
        '三项必须属于同一个账号。手动凭证能否用于后续图片由网站决定，网页校验被拒绝不代表登录失效。手动填写后遇到校验失败，可改用插件浏览器登录，或在网页重新检测一次，并一起更新上传标识和网页校验凭据。'),
      h('p', { className: 'text-theme-muted', style: { ...muted, marginTop: 8 } },
        '这些内容可以代表你的登录身份，请勿发送给他人或放进截图。保存后界面会遮罩显示；Bot 配置文件仍需妥善保管。'),
    ),
  )
}

function SecondsInput({ value, onChange, meta, error }) {
  return h('div', { style: line },
    h('input', {
      type: 'number', className: 'input-field', style: { flex: 1, minWidth: 0 },
      'aria-label': '检测超时（秒）', 'aria-invalid': !!error,
      min: meta.min / 1000, max: meta.max / 1000, step: 'any',
      value: value === undefined ? '' : value / 1000,
      onChange: event => onChange(event.target.value === '' ? undefined : Math.round(Number(event.target.value) * 1000)),
    }),
    h('span', { className: 'text-theme-secondary' }, '秒'),
  )
}

function SynthIdFields({ value, onChange }) {
  const editor = useContext(SynthIdEditorContext)
  const current = { ...value, credentials: value?.credentials && typeof value.credentials === 'object' ? value.credentials : {} }
  const latest = useRef({ value: current, onChange })
  latest.current = { value: current, onChange }
  if (!editor) return null
  const credentialErrors = Object.fromEntries(Object.entries(editor.errors)
    .filter(([path]) => path.startsWith('synthid.credentials.'))
    .map(([path, message]) => [path.slice('synthid.credentials.'.length), message]))
  const synthidErrors = Object.fromEntries(Object.entries(editor.errors)
    .filter(([path]) => path.startsWith('synthid.'))
    .map(([path, message]) => [path.slice('synthid.'.length), message]))
  const updateCredentials = credentials => latest.current.onChange({ ...latest.current.value, credentials })
  return h('section', { 'aria-label': 'SynthID 检测设置',
    className: 'rounded-xl border border-theme-divider', style: { padding: 16, display: 'grid', gap: 16, minWidth: 0 } },
    h(SynthIdAccount, { credentials: current.credentials, onCredentials: updateCredentials }),
    h(CredentialHelp),
    synthidErrors.credentials && h('p', { style: errorStyle, role: 'alert' }, synthidErrors.credentials),
    h(SchemaForm, { schema: editor.credentialsSchema, value: current.credentials, onChange: updateCredentials,
      errors: credentialErrors, fields: credentialKeys }),
    h(SchemaForm, { schema: editor.synthidSchema, value: current, onChange, errors: synthidErrors, fields: ['timeout'] }),
  )
}

function DetectorEditor({ value, onChange, schema, errors = {} }) {
  // The host owns the SynthID switch. Its object branch renders the login and
  // credential fields together, while all changes still use the outer save.
  const schemas = useMemo(() => {
    const copy = structuredClone(schema)
    const refs = copy?.refs
    const synthid = refs?.[refs[copy.uid]?.dict?.synthid]
    let synthidSchema
    let credentialsSchema
    for (const branch of synthid?.list ?? []) {
      const node = refs[branch]
      if (node?.type !== 'object') continue
      node.meta = { ...node.meta, role: 'aiimgdetector-synthid' }
      synthidSchema = { uid: branch, refs }
      const credentialNode = refs[node.dict?.credentials]
      const credentialUid = credentialNode?.type === 'object' ? node.dict.credentials
        : credentialNode?.list?.find(uid => refs[uid]?.type === 'object')
      if (credentialUid !== undefined) credentialsSchema = { uid: credentialUid, refs }
      const timeout = refs[node.dict?.timeout]
      if (timeout) timeout.meta = { ...timeout.meta, role: 'aiimgdetector-seconds' }
    }
    return { editorSchema: copy, synthidSchema, credentialsSchema }
  }, [schema])
  const { '': rootError, ...fieldErrors } = errors
  const form = fields => h(SchemaForm, { schema: schemas.editorSchema, value, onChange, errors: fieldErrors, fields })
  return h(SynthIdEditorContext.Provider, { value: { ...schemas, errors: fieldErrors } },
    h('div', { style: { display: 'grid', gap: 20 } },
      rootError && h('p', { style: errorStyle, role: 'alert' }, rootError),
      form(['trigger', 'cooldown', 'provenance', 'synthid', 'vision']),
    ),
  )
}

export default function apply(ctx) {
  ctx.field('aiimgdetector-synthid', SynthIdFields)
  ctx.field('aiimgdetector-seconds', SecondsInput)
  ctx.config(DetectorEditor)
}
