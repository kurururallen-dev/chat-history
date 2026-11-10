import { expect, test } from 'claude-code/testing'

test('提示列畫出過往對話按鈕', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine hint</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'chat-history',
    component: 'PromptHint',
    surface: 'terminal',
    props: { isDraft: false, isWorking: false, hint: 'engine hint' },
  } as any)
  const b = await ui.find({ type: 'Button', key: 'chats-toggle' } as any)
  expect(b).toBeTruthy()
  const t = await ui.find({ type: 'Text', text: /engine hint/ })
  expect(t?.text).toBe('engine hint')
  await ui.unmount()
})
