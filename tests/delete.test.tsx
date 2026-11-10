import { expect, test } from 'claude-code/testing'

const CWD = '/vault'
const HISTORY = [
  JSON.stringify({ sessionId: 'aaaa', project: CWD, display: '舊的對話', timestamp: 1000 }),
  JSON.stringify({ sessionId: 'self', project: CWD, display: '目前這段', timestamp: 2000 }),
].join('\n')
const PANE = {
  plugin: 'chat-history', component: 'Pane', requestId: 'chat-history', surface: 'terminal',
  props: { title: '過往對話', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('按兩次刪除：檔案搬到 chat-archive，面板不再列出；目前的對話沒有刪除鈕', async ($, on) => {
  const store: Record<string, unknown> = { assign: { aaaa: { project: '其他', isManual: true } } }
  const runs: string[][] = []
  on('env.get', () => ({ value: '/home' }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: 'self' }))
  on('fs.read', (_, e: any) => ({ value: String(e.path).endsWith('history.jsonl') ? HISTORY : '## 專案\n- 其他：雜事' }))
  on('fs.list', () => ({ value: [{ name: '-vault', kind: 'dir', size: 0 }, { name: 'x.txt', kind: 'file', size: 0 }] }))
  on('fs.exists', (_, e: any) => ({ value: e.path === '/home/.claude/projects/-vault/aaaa.jsonl' }))
  on('process.run', (_, e: any) => { runs.push([...e.argv]); return { value: { exitCode: 0, stdout: '', stderr: '' } } })
  on('store.get', (_, e: any) => ({ value: store[e.key] }))
  on('store.set', (_, e: any) => { store[e.key] = e.value; return { value: undefined } })
  on('store.delete', (_, e: any) => { delete store[e.key]; return { value: undefined } })
  on('command.register', () => ({ value: { command: 'chats' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '{}', usage: {} } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await new Promise(r => setTimeout(r, 50))

  const ui = await $.ui.mount(PANE as any)
  expect(await ui.find({ type: 'Button', key: 'd-self' } as any)).toBeFalsy()
  await ui.press({ key: 'd-aaaa' } as any)
  await new Promise(r => setTimeout(r, 30))
  expect(runs.length).toBe(0) // 第一次只問
  const asked: any = await ui.find({ type: 'Button', key: 'd-aaaa' } as any)
  expect(asked?.text ?? asked?.label).toMatch(/確定刪除/)
  await ui.press({ key: 'd-aaaa' } as any)
  await new Promise(r => setTimeout(r, 50))
  expect(runs).toContainEqual(['mv', '/home/.claude/projects/-vault/aaaa.jsonl', '/home/.claude/chat-archive/-vault/aaaa.jsonl'])
  expect(store.hidden).toEqual(['aaaa'])
  expect(await ui.find({ type: 'Text', text: /舊的對話/ })).toBeFalsy()
  await ui.unmount()
})
