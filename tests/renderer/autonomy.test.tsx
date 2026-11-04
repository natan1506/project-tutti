// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunEvent } from '@shared/events'
import { ApprovalCard } from '../../src/renderer/components/ApprovalCard'
import { AutonomyPicker } from '../../src/renderer/components/AutonomyPicker'
import { StopAllButton } from '../../src/renderer/components/StopAllButton'
import { applyEvent, emptyChat } from '../../src/renderer/state/chat'
import { useRunStore } from '../../src/renderer/state/runStore'

afterEach(cleanup)

let activityCb: ((n: number) => void) | undefined
const api = {
  autonomy: vi.fn(async () => 'accept_edits' as const),
  setAutonomy: vi.fn(async () => {}),
  stopAll: vi.fn(async () => {}),
  activity: vi.fn(async () => 0),
  onActivity: vi.fn((cb: (n: number) => void) => { activityCb = cb; return () => { activityCb = undefined } }),
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window, { time: api })
  useRunStore.setState({ project: { id: 'p1', path: '/proj', name: 'proj', lastOpenedAt: 0 } })
})

describe('seletor de autonomia', () => {
  it('três níveis; marca o do projeto; Sozinho grava e fica em destaque', async () => {
    const r = render(<AutonomyPicker />)
    await act(async () => {})
    expect(api.autonomy).toHaveBeenCalledWith('/proj')
    expect(['Perguntar tudo', 'Aceitar edições', 'Sozinho'].map(t => !!r.getByText(t))).toEqual([true, true, true])
    expect(r.getByText('Aceitar edições').className).toContain('on')
    await act(async () => { fireEvent.click(r.getByText('Sozinho')) })
    expect(api.setAutonomy).toHaveBeenCalledWith('/proj', 'autonomous')
    expect(r.getByText('Sozinho').className).toContain('on')
    expect(r.getByText('Sozinho').className).toContain('alert')
  })

  it('sem projeto: desabilitado', async () => {
    useRunStore.setState({ project: undefined })
    const r = render(<AutonomyPicker />)
    await act(async () => {})
    expect((r.getByText('Sozinho') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('motivo da aprovação', () => {
  it('cartão mostra o motivo; sem motivo, o texto de antes', () => {
    const r = render(<ApprovalCard approval={{ id: 'a', toolName: 'Bash', summary: 'rm -rf dist', reason: 'destructive' }} />)
    expect(r.getByText('Pede sua aprovação · destrutivo ou irreversível')).toBeTruthy()
    cleanup()
    const r2 = render(<ApprovalCard approval={{ id: 'a', toolName: 'Bash', summary: 'x' }} />)
    expect(r2.getByText('Pede sua aprovação')).toBeTruthy()
  })

  it('o chat guarda o motivo do evento', () => {
    const evs: [string, RunEvent][] = [
      ['r', { type: 'run_started', runId: 'r', agentId: 'forja' }],
      ['r', { type: 'approval_request', id: 'a', toolName: 'Bash', summary: 'git push', reason: 'destructive' }],
    ]
    const s = evs.reduce((st, [id, ev]) => applyEvent(st, id, ev), emptyChat())
    expect(s.runs[0].approvals[0]).toMatchObject({ id: 'a', reason: 'destructive' })
  })
})

describe('Parar tudo', () => {
  it('desabilitado sem nada rodando; habilita com atividade; clique e ⌘ + . param tudo', async () => {
    const r = render(<StopAllButton />)
    await act(async () => {})
    const btn = r.getByRole('button', { name: /Parar tudo/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.keyDown(window, { key: '.', metaKey: true })
    expect(api.stopAll).not.toHaveBeenCalled()
    await act(async () => { activityCb?.(2) })
    expect(btn.disabled).toBe(false)
    await act(async () => { fireEvent.click(btn) })
    expect(api.stopAll).toHaveBeenCalledTimes(1)
    await act(async () => { fireEvent.keyDown(window, { key: '.', metaKey: true }) })
    expect(api.stopAll).toHaveBeenCalledTimes(2)
  })
})
