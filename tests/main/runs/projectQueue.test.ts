import { describe, expect, it } from 'vitest'
import { ProjectQueue } from '../../../src/main/runs/projectQueue'

const flush = () => new Promise(r => setTimeout(r, 0))

describe('ProjectQueue', () => {
  it('o primeiro entra na hora; o segundo espera e é avisado da posição', async () => {
    const q = new ProjectQueue()
    const pos: number[] = []
    let second = false
    await q.acquire('/p', 'a')
    void q.acquire('/p', 'b', p => pos.push(p)).then(() => { second = true })
    await flush()
    expect(second).toBe(false)
    expect(pos).toEqual([1])
    q.release('/p', 'a')
    await flush()
    expect(second).toBe(true)
    expect(pos).toEqual([1, 0])
    expect(q.position('/p', 'b')).toBe(0)
  })

  it('tirar da fila quem não começou faz os outros subirem', async () => {
    const q = new ProjectQueue()
    const posC: number[] = []
    await q.acquire('/p', 'a')
    void q.acquire('/p', 'b')
    void q.acquire('/p', 'c', p => posC.push(p))
    await flush()
    expect(posC).toEqual([2])
    expect(q.remove('/p', 'b')).toBe(true)
    expect(posC).toEqual([2, 1])
    expect(q.position('/p', 'b')).toBe(-1)
    expect(q.remove('/p', 'a')).toBe(false)
  })

  it('projetos diferentes não se esperam', async () => {
    const q = new ProjectQueue()
    await q.acquire('/p', 'a')
    let other = false
    void q.acquire('/outro', 'b').then(() => { other = true })
    await flush()
    expect(other).toBe(true)
  })
})
