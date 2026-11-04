import { getAgent } from '@shared/agents'
import type { RunEvent } from '@shared/events'
import { speechFor } from '@shared/voice'
import type { ChatState } from './chat'
import { useProfileStore } from './profileStore'
import { playAudio, stopAudio, createVoicePlayer } from './voicePlayer'
import { useVoiceStore } from './voiceStore'

const TOOL_NAME: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Antigravity', opencode: 'opencode', api: 'API' }

// Liga os eventos dos pedidos às vozes: o que falar vem de `speechFor`, quem toca é o tocador.

export const voicePlayer = createVoicePlayer({
  synth: item => window.time.synthesize({ agentId: item.agentId, text: item.text, name: getAgent(item.agentId).nome }),
  play: playAudio,
  stop: stopAudio,
  muted: () => useVoiceStore.getState().muted,
  onNotice: text => useVoiceStore.setState({ notice: text }),
})

export function speakEvent(chat: ChatState, runId: string, ev: RunEvent): void {
  const run = chat.runs.find(r => r.runId === runId)
  if (!run) return
  const item = speechFor(ev, run, {
    coordinatorId: useProfileStore.getState().active.coordinatorId,
    toolName: t => TOOL_NAME[t] ?? t,
  })
  if (item) voicePlayer.enqueue(item)
}
