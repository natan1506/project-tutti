import { create } from 'zustand'
import type { AgentId } from '@shared/agents'
import type { RunEvent } from '@shared/events'
import type { Conversation, Project } from '@shared/models'
import { applyEvent, emptyChat, withPrompt, type ChatState } from './chat'

interface UiState {
  project?: Project
  conversation?: Conversation
  chat: ChatState
  selectedAgent: AgentId
  setProject(p: Project): Promise<void>
  selectAgent(id: AgentId): void
  newConversation(): void
  openConversation(c: Conversation): Promise<void>
  send(prompt: string): Promise<void>
  receive(runId: string, ev: RunEvent): void
}

export const useRunStore = create<UiState>((set, get) => ({
  chat: emptyChat(),
  selectedAgent: 'forja',

  async setProject(project) {
    set({ project, conversation: undefined, chat: emptyChat() })
    const [latest] = await window.time.listConversations(project.id)
    if (latest) await get().openConversation(latest)
  },

  selectAgent: selectedAgent => set({ selectedAgent }),

  newConversation: () => set({ conversation: undefined, chat: emptyChat() }),

  async openConversation(conversation) {
    const { runs, events } = await window.time.loadConversation(conversation.id)
    let chat = emptyChat()
    for (const r of runs) {
      for (const ev of events[r.id] ?? []) chat = applyEvent(chat, r.id, ev)
      chat = withPrompt(chat, r.id, r.prompt)
    }
    // Ao reabrir, ninguém está trabalhando: o estado dos mascotes começa do zero.
    set({ conversation, chat: { ...chat, agentStatus: emptyChat().agentStatus } })
  },

  async send(prompt) {
    const { project, selectedAgent } = get()
    if (!project) return
    let { conversation } = get()
    if (!conversation) {
      conversation = await window.time.newConversation(project.id, prompt.slice(0, 40))
      set({ conversation })
    }
    const runId = await window.time.startRun({ projectPath: project.path, conversationId: conversation.id, agentId: selectedAgent, prompt })
    set(s => ({ chat: withPrompt(s.chat, runId, prompt) }))
  },

  receive(runId, ev) {
    set(s => ({ chat: applyEvent(s.chat, runId, ev) }))
  },
}))
