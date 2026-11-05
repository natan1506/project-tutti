import { z } from 'zod'
import { knownAgent } from '@shared/agents'
import { SPEECH_MAX, VOICE_SOURCES, type VoiceSource } from '@shared/voice'
import type { VoiceService } from './voiceService'

// Handlers das vozes, separados do ipc.ts para serem testáveis sem Electron. O texto falado tem limite.

const agent = z.string().refine(knownAgent, 'Agente inválido')
const source = z.enum(VOICE_SOURCES as [VoiceSource, ...VoiceSource[]])
const choice = z.object({ source, voiceId: z.string().min(1).max(200) })

export function voiceHandlers(svc: VoiceService) {
  return {
    voiceStatus: () => svc.status(),
    voiceList: (arg: unknown) => {
      const { source: s, all } = z.object({ source, all: z.boolean().optional() }).parse(arg)
      return svc.list(s, all).then(voices => ({ voices }), (e: unknown) => ({ voices: [], error: e instanceof Error ? e.message : 'FALHOU' }))
    },
    voiceChoice: (arg: unknown) => svc.choiceFor(agent.parse(arg)),
    setVoice: (arg: unknown) => { const { agentId, choice: c } = z.object({ agentId: agent, choice }).parse(arg); svc.setChoice(agentId, c) },
    synthesize: (arg: unknown) => {
      const { agentId, text, name } = z.object({ agentId: agent, text: z.string().min(1).max(SPEECH_MAX + 120), name: z.string().max(60).optional() }).parse(arg)
      return svc.synthesize(agentId, text, name)
    },
    setVoiceKey: (arg: unknown) => svc.setKey(z.string().min(8).max(200).parse(arg)),
    removeVoiceKey: () => svc.removeKey(),
    voiceMuted: () => svc.muted(),
    setVoiceMuted: (arg: unknown) => svc.setMuted(z.boolean().parse(arg)),
  }
}
