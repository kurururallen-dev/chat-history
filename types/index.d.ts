export type PastChat = {
  id: string
  title: string
  last: number
  count: number
  folder: string
  prompts: string[]
}
export type Project = { name: string; hint: string }
export type Assignment = { project: string; isManual: boolean }

declare module 'claude-code' {
  interface PluginState {
    'chat-history': {
      chats: Shaped<PastChat[]>
      cwd: string
      collapsed: string[]
      assign: Record<string, Assignment>
      moving: string
      sorting: boolean
      projects: Project[]
      self: string
      deleting: string
    }
  }
}
