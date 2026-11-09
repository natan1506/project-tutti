// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectPicker } from '../../src/renderer/components/ProjectPicker'
import { useRunStore } from '../../src/renderer/state/runStore'

afterEach(() => { cleanup(); document.body.innerHTML = '' })

describe('seletor de projeto', () => {
  it('abre pasta sem git direto, sem pedir para iniciar repositório', async () => {
    const project = { id: 'p1', path: '/tmp/sem-git', name: 'sem-git' }
    ;(window as unknown as { time: unknown }).time = {
      recentProjects: vi.fn(async () => []),
      pickFolder: vi.fn(async () => '/tmp/sem-git'),
      openProject: vi.fn(async () => ({ project })),
    }
    const setProject = vi.fn(async () => {})
    useRunStore.setState({ project: undefined, setProject } as never)
    const r = render(<ProjectPicker />)
    fireEvent.click(r.getByRole('button', { name: /Abrir projeto/ }))
    fireEvent.click(r.getByRole('button', { name: /Abrir pasta/ }))
    await waitFor(() => expect(setProject).toHaveBeenCalledWith(project))
    expect(r.queryByText(/não usa git/)).toBeNull()
  })
})
