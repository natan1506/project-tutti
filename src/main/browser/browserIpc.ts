import { z } from 'zod'
import { knownAgent, type AgentId } from '@shared/agents'
import { urlAllowed } from './browserPolicy'
import type { BrowserService } from './browserService'

const Bounds = z.object({ x: z.number().finite().min(0), y: z.number().finite().min(0), width: z.number().finite().positive(), height: z.number().finite().positive() }).nullable()

function agent(arg: unknown): AgentId {
  if (typeof arg !== 'string' || !knownAgent(arg)) throw new Error('Agente inválido')
  return arg as AgentId
}

export function browserHandlers(svc: BrowserService) {
  return {
    browserState: () => svc.state(),
    browserBounds: (arg: unknown) => {
      const b = Bounds.parse(arg)
      svc.setBounds(b && { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) })
    },
    browserSelect: (arg: unknown) => svc.select(agent(arg)),
    browserTakeover: (arg: unknown) => svc.takeover(agent(arg)),
    browserRelease: () => svc.release(),
    browserNavigate: (arg: unknown) => {
      if (typeof arg !== 'string' || !urlAllowed(arg)) throw new Error('Endereço inválido')
      return svc.userNavigate(arg)
    },
    browserBack: () => svc.userBack(),
    browserReload: () => svc.userReload(),
    browserClose: (arg: unknown) => svc.closeTab(agent(arg)),
    browserReset: () => svc.closeAll(),
  }
}
