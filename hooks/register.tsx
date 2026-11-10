import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode, Timer } from 'claude-code'

import type { Assignment, PastChat, Project } from '../types'

// 分類清單：安裝時在設定填一份 Markdown 筆記的路徑（taxonomyFile），讀它「## 專案」底下的清單；
// 沒填或讀不到時用這份預設
let TAXONOMY = ''
const DEFAULT_PROJECTS: Project[] = [
  { name: '工作', hint: '客戶、報價、會議、提案、專案進度' },
  { name: '學習', hint: '課程、讀書、筆記、研究、論文' },
  { name: '程式開發', hint: '寫程式、除錯、重構、部署、測試' },
  { name: 'Claude Code 設定', hint: 'Claude Code、mod、外掛、狀態列、skill、設定檔' },
  { name: '設計', hint: '視覺、簡報、字體、排版、動態、配色' },
  { name: '生活', hint: '旅行、健康、購物、興趣' },
  { name: '其他', hint: '其他無法歸類的' },
]
const OTHER_FOLDERS = '其他資料夾'
const UNSORTED = '未分類'

const PANE = 'chat-history'
const PASTE = '（貼上的文字）'
const chats = atom({ plugin: 'chat-history', key: 'chats' } as const, [], { shape: 'chats-3' })
const here = atom({ plugin: 'chat-history', key: 'cwd' } as const, '')
const collapsed = atom({ plugin: 'chat-history', key: 'collapsed' } as const, [])
const assign = atom({ plugin: 'chat-history', key: 'assign' } as const, {})
const moving = atom({ plugin: 'chat-history', key: 'moving' } as const, '')
const sorting = atom({ plugin: 'chat-history', key: 'sorting' } as const, false)
const projects = atom({ plugin: 'chat-history', key: 'projects' } as const, DEFAULT_PROJECTS)
const selfId = atom({ plugin: 'chat-history', key: 'self' } as const, '')
const deleting = atom({ plugin: 'chat-history', key: 'deleting' } as const, '')

// 讀「## 專案」底下的清單；縮排的子專案變成「父／子」
function parseTaxonomy(text: string): Project[] {
  const out: Project[] = []
  let inside = false
  let parent = ''
  for (const line of text.split(/\r?\n/)) {
    if (/^##\s/.test(line)) { inside = /^##\s*專案\s*$/.test(line); continue }
    if (!inside) continue
    const m = line.match(/^(\s*)[-*]\s+([^：:]+)[：:]\s*(.*)$/)
    if (!m) continue
    const isChild = (m[1] ?? '').replace(/\t/g, '  ').length >= 2
    const name = (m[2] ?? '').trim()
    if (!name) continue
    const isReserved = (n: string) => n === UNSORTED || n === OTHER_FOLDERS
    if (!isChild) {
      parent = name
      if (isReserved(name) || out.some(p => p.name === name)) continue
      out.push({ name, hint: m[3] ?? '' })
      continue
    }
    if (!parent || isReserved(parent)) continue
    const full = `${parent}／${name}`
    if (out.some(p => p.name === full)) continue
    out.push({ name: full, hint: m[3] ?? '' })
  }
  return out
}

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 60) return `${m} 分鐘`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} 小時`
  return `${Math.round(h / 24)} 天`
}

const cols = (c: string) =>
  /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(c) ? 2 : 1
const fit = (s: string, max: number) => {
  let used = 0
  let out = ''
  for (const c of s) {
    if (used + cols(c) > max - 1) return `${out}…`
    used += cols(c)
    out += c
  }
  return out
}

const clock = (ms: number) => {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const oneLine = (s: string) => s.replace(/\[Image #\d+\]\s*/g, '').replace(/\s+/g, ' ').trim()
const quote = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`

// 寫入 assign 一次只跑一個，避免先讀後寫互相蓋掉
let saving: Promise<void> = Promise.resolve()
function saveAssign($: EngineInterface, id: string, a: Assignment): Promise<void> {
  const run = saving.then(() => writeAssign($, id, a))
  saving = run.catch(() => undefined)
  return run
}
async function writeAssign($: EngineInterface, id: string, a: Assignment): Promise<void> {
  const all = ((await $.store.get('assign')) ?? {}) as Record<string, Assignment>
  if (!a.isManual && all[id]?.isManual) return
  const next = { ...all, [id]: a }
  await $.store.set('assign', next)
  await update($, assign, () => next)
}

// 比對專案名稱時忽略空白與全形半形（「ClaudeCode設定」「工作|提案」也算對）
const norm = (s: string) => s.normalize('NFKC').replace(/[\s「」"'`]/g, '').replace(/[／/]/g, '/')

// 分不出來的對話記下當時的訊息數（tried2：id → 則數）；之後多了新訊息、或按 ↻，就再試一次
const TRIED = 'tried2'
// 刪除＝把對話檔搬到 ~/.claude/chat-archive/，面板不再列出，/resume 也找不到；
// 不改 history.jsonl（Claude Code 一直在寫它），要救回就把檔案搬回 ~/.claude/projects/ 原資料夾
async function archiveChat($: EngineInterface, chat: PastChat): Promise<boolean> {
  const home = await $.env.get('HOME')
  const root = `${home}/.claude/projects`
  const dirs = await $.fs.list(root).catch(() => [])
  const archive = `${home}/.claude/chat-archive`
  for (const d of dirs) {
    if (d.kind !== 'dir') continue
    const dir = `${root}/${d.name}`
    for (const name of [`${chat.id}.jsonl`, chat.id]) {
      if (!(await $.fs.exists(`${dir}/${name}`).catch(() => false))) continue
      await $.process.run(['mkdir', '-p', `${archive}/${d.name}`])
      const r = await $.process.run(['mv', `${dir}/${name}`, `${archive}/${d.name}/${name}`])
      if (r.exitCode !== 0) return false
    }
  }
  const hidden = ((await $.store.get('hidden')) ?? []) as string[]
  await $.store.set('hidden', [...new Set([...hidden, chat.id])])
  return true // 找不到檔案（已被刪過）也算刪掉，只是從面板藏起來
}

let deleteTimer: Timer | undefined

let isClassifying = false
async function classify($: EngineInterface, todo: PastChat[], list: Project[]): Promise<void> {
  if (todo.length === 0 || isClassifying) return
  isClassifying = true
  const byNorm = new Map(list.map(p => [norm(p.name), p.name]))
  let failed = 0
  try {
    await update($, sorting, () => true)
    for (let i = 0; i < todo.length; i += 20) {
      const batch = todo.slice(i, i + 20)
      // 用 1、2、3 當鍵，不讓模型抄長長的 UUID
      const prompt = [
        '你要把使用者和 AI 助理的對話分到專案。只能用下面這些專案名稱，一字不差：',
        ...list.map(p => `- ${p.name}：${p.hint}`),
        '',
        '規則：',
        '- 有子專案（「父／子」）時，盡量選最細的那層。',
        '- 一段對話談到好幾件事時，選佔最多篇幅或最後在處理的那件。',
        '- 判斷提示只是例子，意思相近就算；真的都不相關才選「其他」。',
        '',
        '對話（編號：使用者說過的話，用 / 分隔）：',
        ...batch.map((c, n) => `${n + 1}：${c.prompts.join(' / ').slice(0, 500)}`),
        '',
        '只回傳 JSON 物件，鍵是編號字串，值是專案名稱，例如 {"1": "工作"}，不要其他文字。',
      ].join('\n')
      const r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 2000 }).catch(() => undefined)
      if (!r || !r.isAnswered) { failed += batch.length; continue }
      let got: Record<string, string> = {}
      try {
        got = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1))
      } catch {
        failed += batch.length
        continue // 解析失敗的這批下次再試
      }
      const missed: PastChat[] = []
      for (const [n, c] of batch.entries()) {
        const raw = got[String(n + 1)]
        const p = raw === undefined ? undefined : byNorm.get(norm(raw))
        if (p) await saveAssign($, c.id, { project: p, isManual: false })
        else missed.push(c)
      }
      if (missed.length > 0) {
        const tried = ((await $.store.get(TRIED)) ?? {}) as Record<string, number>
        for (const c of missed) tried[c.id] = c.count
        await $.store.set(TRIED, tried)
      }
    }
    if (failed > 0) $.ui.toast(`有 ${failed} 段對話沒分類成功，按 ↻ 可以再試一次`)
  } finally {
    isClassifying = false
    await update($, sorting, () => false).catch(() => undefined)
  }
}

// 「＋」按下後只在這個程序裡記著；等 /clear 結束舊對話，下一段新對話才歸類
let armed: { project: string; fromId: string; isCleared: boolean; at: number } | null = null

// 同時進來的 load 合併成一次
let loading: Promise<void> | null = null
let again = false
function load($: EngineInterface): Promise<void> {
  if (loading) { again = true; return loading }
  loading = (async () => {
    try {
      do { again = false; await loadOnce($) } while (again)
    } finally {
      loading = null
    }
  })()
  return loading
}

async function loadOnce($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME')
  const cwd = await $.session.cwd()
  const self = await $.session.id()
  const text = await $.fs.read(`${home}/.claude/history.jsonl`).catch(() => '')
  const byId = new Map<string, PastChat>()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let row: { display?: string; timestamp?: number; project?: string; sessionId?: string }
    try { row = JSON.parse(line) } catch { continue }
    if (!row.sessionId || !row.project) continue
    const raw = oneLine(row.display ?? '')
    if (/^\/[^\s/]+(\s|$)/.test(raw)) continue // 斜線指令；/Users/... 這類路徑不算
    const display = raw.replace(/\[Pasted text #\d+[^\]]*\]\s*/g, '').trim()
    const ts = row.timestamp ?? 0
    const isPaste = display === ''
    const title = isPaste ? PASTE : display
    const had = byId.get(row.sessionId)
    if (!had) {
      byId.set(row.sessionId, { id: row.sessionId, title, last: ts, count: 1, folder: row.project, prompts: isPaste ? [] : [display] })
    } else {
      byId.set(row.sessionId, {
        ...had,
        title: had.title === PASTE && !isPaste ? title : had.title,
        last: Math.max(had.last, ts),
        count: had.count + 1,
        prompts: isPaste || had.prompts.length >= 6 ? had.prompts : [...had.prompts, display],
      })
    }
  }
  const hidden = new Set(((await $.store.get('hidden')) ?? []) as string[])
  const list = [...byId.values()].filter(c => !hidden.has(c.id)).sort((a, b) => b.last - a.last).slice(0, 200)
  const stored = ((await $.store.get('assign')) ?? {}) as Record<string, Assignment>
  await update($, chats, () => list)
  await update($, here, () => cwd)
  await update($, assign, () => stored)
  await update($, selfId, () => self)
  const path = TAXONOMY.startsWith('~/') ? `${home}${TAXONOMY.slice(1)}` : TAXONOMY
  const note = path ? await $.fs.read(path).catch(() => '') : ''
  const parsed = parseTaxonomy(note)
  const taxonomy = parsed.length > 0 ? parsed : DEFAULT_PROJECTS
  await update($, projects, () => taxonomy)
  const ready = armed
  if (ready && Date.now() - ready.at > 30 * 60000) armed = null
  else if (ready && ready.isCleared && ready.fromId !== self) {
    armed = null
    await saveAssign($, self, { project: ready.project, isManual: true })
    $.ui.toast(`新對話歸到「${ready.project}」`)
  }
  const tried = ((await $.store.get(TRIED)) ?? {}) as Record<string, number>
  const latest = ((await $.store.get('assign')) ?? {}) as Record<string, Assignment>
  await update($, assign, () => latest)
  const todo = list.filter(
    c => c.folder === cwd && !latest[c.id] && tried[c.id] !== c.count && c.prompts.length > 0 && c.id !== self,
  )
  void classify($, todo, taxonomy)
}

export const register: Register = (on, options) => {
  const file = typeof options.taxonomyFile === 'string' ? options.taxonomyFile.trim() : ''
  TAXONOMY = file

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'chats', description: '開啟右側的過往對話面板' })
    await $.store.delete('pending') // 舊版留下的
    await $.store.delete('tried') // 舊版「試一次就放棄」的紀錄，改用 tried2
    void load($).catch(() => undefined)
    void $.ui.open({ id: PANE, title: '過往對話' })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (armed && e.reason === 'clear' && e.sessionId === armed.fromId) armed = { ...armed, isCleared: true }
    else armed = null
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    void load($).catch(() => undefined)
    return r
  })

  on('command.run', { command: 'chats' }, async $ => {
    await load($)
    await $.ui.open({ id: PANE, title: '過往對話' })
    return { text: '已開啟過往對話面板。' }
  })

  // 狀態列右邊的開關鈕：整塊狀態列和按鈕並排，按鈕對齊第一行，像是接在狀態列第一行的最後面
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box>
        {hint}
        <Box flexShrink={0} marginLeft={1}>
          <Button
            plain
            key="chats-toggle"
            onPress={async () => {
              const open = await $.ui.panes()
              if (open.some(p => p.id === PANE)) {
                await $.ui.close({ id: PANE })
              } else {
                void load($).catch(() => undefined)
                const r = await $.ui.open({ id: PANE, title: '過往對話' })
                if (!r.isPlaced) $.ui.toast('終端機太窄，面板放不下；把視窗拉寬一點')
              }
            }}
          >
            <Text color="claude">☰ 過往對話</Text>
          </Button>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, chats)
    const cwd = await read($, here)
    const shut = await read($, collapsed)
    const given = await read($, assign)
    const movingId = await read($, moving)
    const deletingId = await read($, deleting)
    const isSorting = await read($, sorting)
    const taxonomy = await read($, projects)
    const NAMES = taxonomy.map(p => p.name)
    const self = await read($, selfId)
    const width = Math.max(12, (e.props.bodyColumns ?? 40) - 4)

    // 未分類排最前面，剛開的對話一眼看得到；面板太長時用方向鍵捲動
    const groups = new Map<string, PastChat[]>()
    groups.set(UNSORTED, [])
    for (const name of NAMES) groups.set(name, [])
    groups.set(OTHER_FOLDERS, [])
    for (const chat of list) {
      const want = given[chat.id]?.project
      const key = chat.folder !== cwd ? OTHER_FOLDERS : want && NAMES.includes(want) ? want : UNSORTED
      groups.get(key)?.push(chat)
    }

    const toggle = (name: string) =>
      void update($, collapsed, now => (now.includes(name) ? now.filter(p => p !== name) : [...now, name]))
    const isProject = (name: string) => NAMES.includes(name)

    const rows: RenderNode[] = []
    const newChatIn = async (name: string) => {
      armed = { project: name, fromId: await $.session.id(), isCleared: false, at: Date.now() }
      await $.prompt.fill({ text: '/clear' })
      void $.ui.toast(`按 Enter 開新對話；送出第一句後會歸到「${name}」`)
    }
    // 沒有對話的專案收進最底下的「空的專案」，預設收合，不佔版面
    const empty: string[] = []
    for (const [name, items] of groups) {
      if (items.length === 0) {
        if (isProject(name)) empty.push(name)
        continue
      }
      const isOpen = name === OTHER_FOLDERS ? shut.includes(name) : !shut.includes(name)
      const header: RenderNode[] = [
        <Button plain key={`pb-${name}`} onPress={() => toggle(name)}>
          <Text color="claude" bold>{isOpen ? '▾' : '▸'} {fit(name, width - 6)}</Text>
          <Text dimColor> {items.length}</Text>
        </Button>,
      ]
      if (isProject(name)) {
        header.push(
          <Button
            plain
            dimColor
            key={`new-${name}`}
            onPress={() => newChatIn(name)}
          >
            ＋
          </Button>,
        )
      }
      rows.push(
        <Box key={`p-${name}`} marginTop={rows.length === 0 || items.length === 0 ? 0 : 1} justifyContent="space-between">
          {header}
        </Box>,
      )
      if (!isOpen) continue
      for (const chat of items) {
        const isHere = chat.folder === cwd
        const isSelf = chat.id === self
        const label: RenderNode[] = [<Text color="white">{fit(chat.title, width - (isSelf ? 9 : 2))}</Text>]
        if (isSelf) label.push(<Text color="claude"> ● 目前</Text>)
        const meta: RenderNode[] = [
          <Text dimColor>{clock(chat.last)} · {ago(chat.last)}前 · {chat.count} 則 </Text>,
        ]
        if (isHere) {
          meta.push(
            <Button
              plain
              dimColor
              key={`m-${chat.id}`}
              onPress={() => void update($, moving, now => (now === chat.id ? '' : chat.id))}
            >
              {movingId === chat.id ? '取消' : '移動'}
            </Button>,
          )
        }
        if (!isSelf) {
          const isAsking = deletingId === chat.id
          meta.push(<Text> </Text>)
          meta.push(
            <Button
              plain
              dimColor={!isAsking}
              key={`d-${chat.id}`}
              onPress={async () => {
                if (!isAsking) {
                  // 按兩次才刪：第一次變成「確定刪除？」，3 秒內再按才執行
                  await update($, deleting, () => chat.id)
                  deleteTimer?.cancel()
                  deleteTimer = $.clock.after(3000, () => void update($, deleting, now => (now === chat.id ? '' : now)))
                  return
                }
                await update($, deleting, () => '')
                const isDone = await archiveChat($, chat).catch(() => false)
                $.ui.toast(isDone ? '已刪除（檔案移到 ~/.claude/chat-archive，可救回）' : '刪除失敗，請再試一次')
                void load($).catch(() => undefined)
              }}
            >
              {isAsking ? '確定刪除？' : '刪除'}
            </Button>,
          )
        }
        const body: RenderNode[] = [
          <Button
            plain
            key={`b-${chat.id}`}
            onPress={async press => {
              if (isSelf) {
                $.ui.toast('這就是目前的對話')
              } else if (isHere) {
                await $.prompt.fill({ text: `/resume ${chat.id}` })
                $.ui.toast('按 Enter 切換到這段對話')
              } else {
                const command = `cd ${quote(chat.folder)} && claude --resume ${chat.id}`
                const r = await $.ui.copy({ text: command, surface: press.surface })
                if (r.isCopied) $.ui.toast('已複製指令，貼到新的終端機分頁執行')
                else $.ui.toast(`無法複製，請到終端機執行：${command}`)
              }
            }}
          >
            {label}
          </Button>,
          <Box key={`meta-${chat.id}`}>{meta}</Box>,
        ]
        if (movingId === chat.id) {
          body.push(
            <Box key={`menu-${chat.id}`} flexDirection="column" paddingX={1}>
              {NAMES.map(p => (
                <Button
                  plain
                  key={`to-${chat.id}-${p}`}
                  onPress={async () => {
                    const isSaved = await saveAssign($, chat.id, { project: p, isManual: true }).then(() => true, () => false)
                    await update($, moving, () => '')
                    $.ui.toast(isSaved ? `已移到「${p}」` : '移動失敗，請再試一次')
                  }}
                >
                  <Text color={given[chat.id]?.project === p ? 'claude' : 'white'}>→ {fit(p, width - 4)}</Text>
                </Button>
              ))}
            </Box>,
          )
        }
        rows.push(
          <Box key={chat.id} flexDirection="column" paddingX={2} hover={{ backgroundColor: 'subtle' }}>
            {body}
          </Box>,
        )
      }
    }

    if (empty.length > 0) {
      const EMPTY = '空的專案'
      const isOpen = shut.includes(EMPTY) // 預設收合
      rows.push(
        <Box key="p-empty" marginTop={rows.length === 0 ? 0 : 1}>
          <Button plain key="pb-empty" onPress={() => toggle(EMPTY)}>
            <Text dimColor>{isOpen ? '▾' : '▸'} {EMPTY}</Text>
            <Text dimColor> {empty.length}</Text>
          </Button>
        </Box>,
      )
      if (isOpen) {
        for (const name of empty) {
          rows.push(
            <Box key={`e-${name}`} paddingX={2}>
              <Button plain dimColor key={`new-${name}`} onPress={() => newChatIn(name)}>
                ＋ {fit(name, width - 4)}
              </Button>
            </Box>,
          )
        }
      }
    }

    const top: RenderNode[] = []
    if (isSorting) top.push(<Text dimColor>分類中… </Text>)
    top.push(
      <Button
        plain
        dimColor
        key="refresh"
        onPress={async () => {
          await $.store.delete(TRIED) // 手動刷新：之前分不出來的也重新試
          void load($).catch(() => undefined)
        }}
      >
        ↻
      </Button>,
    )

    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between" marginBottom={1}>
          <Text color="claude" bold>過往對話</Text>
          <Box>{top}</Box>
        </Box>
        {rows}
      </Box>
    )
  })
}
