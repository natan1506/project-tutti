// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChatPanel } from '../../src/renderer/components/ChatPanel'
import { applyEvent, emptyChat } from '../../src/renderer/state/chat'
import { useRunStore } from '../../src/renderer/state/runStore'

afterEach(cleanup)
beforeEach(() => {
  Element.prototype.scrollTo = () => {}
  let chat = applyEvent(emptyChat(), 'r1', { type: 'run_started', runId: 'r1', agentId: 'forja' })
  chat = applyEvent(chat, 'r1', { type: 'approval_request', id: 'a1', toolName: 'Bash', summary: 'rm -f a.txt', reason: 'destructive' })
  chat = applyEvent(chat, 'r1', { type: 'question', id: 'q1', text: 'Qual banco?' })
  Object.assign(window, { time: { cancelRun: async () => {}, respondApproval: async () => {}, answerQuestion: async () => {} } })
  useRunStore.setState({ chat, project: { id: 'p', path: '/p', name: 'p', lastOpenedAt: 0 } })
})

describe('aprovações sempre visíveis', () => {
  it('pendentes ficam na área fixa embaixo do chat, com o nome do agente, e não repetem na conversa', () => {
    const r = render(<ChatPanel />)
    const dock = r.container.querySelector('.pending-dock') as HTMLElement
    expect(dock).toBeTruthy()
    expect(dock.textContent).toContain('Esperando você (2)')
    expect(dock.querySelector('.approval code')?.textContent).toBe('rm -f a.txt')
    expect(dock.textContent).toContain('Forja')
    expect(dock.textContent).toContain('Qual banco?')
    const log = r.container.querySelector('.log') as HTMLElement
    expect(log.querySelector('.approval:not(.answered)')).toBeNull()
    expect(log.textContent).toContain('Esperando sua resposta embaixo')
  })
})
