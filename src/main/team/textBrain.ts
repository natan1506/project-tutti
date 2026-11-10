import type { AgentDef } from '@shared/agents'
import type { AgentAdapter } from '../adapters/types'
import { effectiveModel } from '../runs/runService'
import { LINEUP_SCHEMA, PLAN_SCHEMA, REVIEW_SCHEMA, TRIAGE_SCHEMA, withInstructions, type Brain, type UsageSink } from './brain'
import { extractJson } from './parse'
import { esteiraPlanPrompt, lineupPrompt, reviewPrompt, triagePrompt } from './prompts'

// Cérebro de coordenador que não é Claude por CLI (spec custos-e-perfis §6): roda o próprio coordenador em modo
// consulta, pede o JSON no texto e lê com `extractJson`; quem valida é o `parse*` de sempre.

export class TextBrain implements Brain {
  constructor(private adapter: AgentAdapter, private coordinator: AgentDef) {}

  private async ask(prompt: string, schema: object, cwd: string, signal: AbortSignal, onUsage?: UsageSink): Promise<unknown> {
    const model = effectiveModel(this.coordinator)
    let text = ''
    for await (const ev of this.adapter.run({
      agent: this.coordinator, cwd, instructions: '', signal, mode: 'consult', requestApproval: async () => false, ...(model ? { model } : {}),
      prompt: `${prompt}\n\nResponda SOMENTE com um JSON neste formato (JSON Schema), sem mais nada:\n${JSON.stringify(schema)}`,
    })) {
      if (ev.type === 'text') text += (text ? '\n' : '') + ev.text
      if (ev.type === 'usage' || ev.type === 'limit') onUsage?.(ev)
      if (ev.type === 'error') throw new Error(ev.message)
    }
    return extractJson(text)
  }

  triage(i: Parameters<Brain['triage']>[0]) {
    return this.ask(triagePrompt(i.prompt, i.available, this.coordinator.id), TRIAGE_SCHEMA, i.cwd, i.signal, i.onUsage)
  }

  lineup(i: Parameters<Brain['lineup']>[0]) {
    return this.ask(lineupPrompt(i.prompt, i.triage, i.confirmations, i.available, this.coordinator.id), LINEUP_SCHEMA, i.cwd, i.signal, i.onUsage)
  }

  plan(i: Parameters<Brain['plan']>[0]) {
    return this.ask(withInstructions(esteiraPlanPrompt(i.prompt, this.coordinator.id), i.instructions), PLAN_SCHEMA, i.cwd, i.signal, i.onUsage)
  }

  review(i: Parameters<Brain['review']>[0]) {
    return this.ask(withInstructions(reviewPrompt(i.prompt, i.plan, i.executor, i.tester, this.coordinator.id, i.check), i.instructions), REVIEW_SCHEMA, i.cwd, i.signal, i.onUsage)
  }
}
