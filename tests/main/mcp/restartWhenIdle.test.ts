import { describe, expect, it, vi } from 'vitest'
import { RestartWhenIdle } from '../../../src/main/mcp/restartWhenIdle'

describe('reiniciar o opencode só parado', () => {
  it('pedido rodando: espera; quando zera, reinicia uma vez', () => {
    const restart = vi.fn()
    const r = new RestartWhenIdle(restart)
    r.activity(1)
    r.request()
    expect(restart).not.toHaveBeenCalled()
    r.activity(0)
    expect(restart).toHaveBeenCalledTimes(1)
    r.activity(0)
    expect(restart).toHaveBeenCalledTimes(1)
  })
  it('parado: reinicia na hora', () => {
    const restart = vi.fn()
    new RestartWhenIdle(restart).request()
    expect(restart).toHaveBeenCalledTimes(1)
  })
})
