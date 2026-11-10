import { expect, test } from 'claude-code/testing'

const CWD = '/vault'
const line = (id: string, text: string, ts: number) =>
  JSON.stringify({ sessionId: id, project: CWD, display: text, timestamp: ts })
const HISTORY = [
  line('aaaa', '幫我改狀態列的顏色', 1000),
  line('bbbb', '整理我的讀書筆記', 2000),
  line('self', '目前這段', 3000),
].join('\n')
const NOTE = ['## 專案', '- 學習：讀書、筆記', '- Claude Code 與工具設定：狀態列、mod', '- 生活：旅行、購物'].join('\n')

const PANE = {
  plugin: 'chat-history',
  component: 'Pane',
  requestId: 'chat-history',
  surface: 'terminal',
  props: { title: '過往對話', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('名稱格式不同也能分類，空的專案收起來', { options: { taxonomyFile: '/notes/分類.md' } }, async ($, on) => {
  const store: Record<string, unknown> = {}
  on('env.get', () => ({ value: '/home' }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: 'self' }))
  on('fs.read', (_, e: any) => ({ value: String(e.path).endsWith('history.jsonl') ? HISTORY : NOTE }))
  on('store.get', (_, e: any) => ({ value: store[e.key] }))
  on('store.set', (_, e: any) => { store[e.key] = e.value; return { value: undefined } })
  on('store.delete', (_, e: any) => { delete store[e.key]; return { value: undefined } })
  on('command.register', () => ({ value: { command: 'chats' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  // Haiku 回傳多了空白、全形符號，還附了說明文字
  on('model.complete', () => ({
    value: { isAnswered: true, text: '好的：\n{"1": "學習", "2": "Claude Code與工具設定"}', usage: {} },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 50 && Object.keys((store.assign as object) ?? {}).length < 2; i++) await new Promise(r => setTimeout(r, 10))

  const assign = store.assign as Record<string, { project: string }>
  expect(assign.bbbb?.project).toBe('學習')
  expect(assign.aaaa?.project).toBe('Claude Code 與工具設定')

  const ui = await $.ui.mount(PANE as any)
  expect(await ui.find({ type: 'Text', text: /空的專案/ })).toBeTruthy()
  expect(await ui.find({ type: 'Button', text: /生活/ } as any)).toBeFalsy()
  await ui.unmount()
})
