// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startToolRefresh } from '../../src/renderer/state/toolRefresh'

describe('startToolRefresh (I6)', () => {
  afterEach(() => vi.useRealTimers())
  it('recarrega na hora, a cada minuto e quando a janela volta ao foco', async () => {
    vi.useFakeTimers()
    const load = vi.fn(async () => {})
    const stop = startToolRefresh(load, 60_000)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new Event('focus'))
    expect(load).toHaveBeenCalledTimes(3)
    stop()
    await vi.advanceTimersByTimeAsync(120_000)
    window.dispatchEvent(new Event('focus'))
    expect(load).toHaveBeenCalledTimes(3)
  })
})
