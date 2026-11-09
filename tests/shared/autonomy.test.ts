import { describe, expect, it } from 'vitest'
import { APPROVAL_REASON_LABEL, AUTONOMY_LABEL, AUTONOMY_LEVELS, DEFAULT_AUTONOMY, isAutonomyLevel } from '@shared/autonomy'

describe('autonomia', () => {
  it('três níveis, nesta ordem, com os rótulos do design', () => {
    expect(AUTONOMY_LEVELS).toEqual(['ask_all', 'accept_edits', 'autonomous'])
    expect(AUTONOMY_LEVELS.map(l => AUTONOMY_LABEL[l])).toEqual(['Perguntar tudo', 'Aceitar edições', 'Sozinho'])
    expect(DEFAULT_AUTONOMY).toBe('accept_edits')
  })
  it('valida o nível', () => {
    expect(isAutonomyLevel('autonomous')).toBe(true)
    expect(isAutonomyLevel('sozinho')).toBe(false)
    expect(isAutonomyLevel(undefined)).toBe(false)
  })
  it('motivos da aprovação', () => {
    expect(APPROVAL_REASON_LABEL).toEqual({
      ask_all: 'você pediu para perguntar tudo', destructive: 'destrutivo ou irreversível', outside: 'fora do projeto',
      network: 'acesso à internet', unknown: 'comando que o Tutti não reconhece', mcp: 'ação de um MCP fora do projeto',
    })
  })
})
