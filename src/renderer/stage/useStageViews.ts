import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentDef, AgentId } from '@shared/agents'
import { useProfileStore } from '../state/profileStore'
import { useRunStore } from '../state/runStore'
import { deriveStage, type MascotView } from './derive'

type Views = Record<AgentId, MascotView>

/** Reaproveita os objetos de quem não mudou, para o React não redesenhar mascote nenhum à toa. */
export function stableViews(prev: Views | undefined, next: Views): Views {
  if (!prev) return next
  let same = Object.keys(prev).length === Object.keys(next).length
  const out = {} as Views
  for (const id of Object.keys(next) as AgentId[]) {
    const keep = prev[id] && JSON.stringify(prev[id]) === JSON.stringify(next[id])
    out[id] = keep ? prev[id] : next[id]
    if (!keep) same = false
  }
  return same ? prev : out
}

/** Estado dos mascotes; rederiva a cada meio segundo para os balões de "concluído" sumirem no tempo certo. */
export function useStageViews(agents: readonly AgentDef[]): Views {
  const chat = useRunStore(s => s.chat)
  const tools = useRunStore(s => s.tools)
  const status = useProfileStore(s => s.status)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])
  const last = useRef<Views>(undefined)
  return useMemo(() => (last.current = stableViews(last.current, deriveStage(chat, now, tools, agents, status))), [chat, now, tools, agents, status])
}

export const anyActive = (views: Views) => Object.values(views).some(v => v && ['thinking', 'working', 'waiting'].includes(v.pose))
