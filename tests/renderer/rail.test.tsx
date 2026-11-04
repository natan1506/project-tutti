// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Rail } from '../../src/renderer/components/Rail'
import { useProfileStore } from '../../src/renderer/state/profileStore'
import { useSkillStore } from '../../src/renderer/state/skillStore'
import { useVoiceStore } from '../../src/renderer/state/voiceStore'

afterEach(cleanup)
beforeEach(() => {
  useProfileStore.setState({ configOpen: false })
  useSkillStore.setState({ open: false })
  useVoiceStore.setState({ open: false })
})

describe('barra lateral', () => {
  it('abre perfis, skills e vozes; o botão aberto fica marcado', () => {
    const r = render(<Rail />)
    fireEvent.click(r.getByRole('button', { name: 'Perfis' }))
    expect(useProfileStore.getState().configOpen).toBe(true)
    fireEvent.click(r.getByRole('button', { name: 'Skills' }))
    expect(useSkillStore.getState().open).toBe(true)
    fireEvent.click(r.getByRole('button', { name: 'Vozes' }))
    expect(useVoiceStore.getState().open).toBe(true)
    expect(r.getByRole('button', { name: 'Vozes' }).getAttribute('aria-pressed')).toBe('true')
  })
})
