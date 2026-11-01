import { create } from 'zustand'
import type { AgentId, ToolKind } from '@shared/agents'
import type { RunEvent } from '@shared/events'
import type { Conversation, Project, ToolStatus } from '@shared/models'
import { useProfileStore } from './profileStore'
import { applyEvent, chatFromHistory, emptyChat, withPrompt, type ChatState } from './chat'

interface UiState {
  project?: Project
  conversation?: Conversation
  chat: ChatState
  selectedAgent: AgentId | 'time'
  fullRound: boolean
  forcePlan: boolean
  setTeamOptions(o: Partial<{ fullRound: boolean; forcePlan: boolean }>): void
  tools?: Record<ToolKind, ToolStatus>
  loadTools(): Promise<void>
  setProject(p: Project): Promise<void>
  selectAgent(id: AgentId | 'time'): void
  newConversation(): void
  openConversation(c: Conversation): Promise<void>
  send(prompt: string): Promise<void>
  receive(runId: string, ev: RunEvent): void
}

export const useRunStore = create<UiState>((set, get) => ({
  chat: emptyChat(),
  selectedAgent: 'time',
  fullRound: false,
  forcePlan: false,
  setTeamOptions: o => set(o),

  async setProject(project) {
    set({ project, conversation: undefined, chat: emptyChat() })
    const [latest] = await window.time.listConversations(project.id)
    if (latest) await get().openConversation(latest)
  },

  selectAgent: selectedAgent => set({ selectedAgent }),

  async loadTools() {
    set({ tools: await window.time.toolStatus() })
    // Quem entrou ou saiu de uma CLI muda a disponibilidade dos agentes do perfil também.
    const { project } = get()
    if (project) await useProfileStore.getState().refreshStatus(project.id)
  },

  newConversation: () => set({ conversation: undefined, chat: emptyChat() }),

  async openConversation(conversation) {
    const { runs, events } = await window.time.loadConversation(conversation.id)
    set({ conversation, chat: chatFromHistory(runs, events) })
  },

  async send(prompt) {
    const { project, selectedAgent, fullRound, forcePlan } = get()
    if (!project) return
    let { conversation } = get()
    if (!conversation) {
      conversation = await window.time.newConversation(project.id, prompt.slice(0, 40))
      set({ conversation })
    }
    const base = { projectPath: project.path, conversationId: conversation.id, prompt }
    const runId = selectedAgent === 'time'
      ? await window.time.startTeam({ ...base, fullRound, forcePlan })
      : await window.time.startRun({ ...base, agentId: selectedAgent })
    set(s => ({ chat: withPrompt(s.chat, runId, prompt) }))
  },

  receive(runId, ev) {
    set(s => ({ chat: applyEvent(s.chat, runId, ev) }))
  },
}))
