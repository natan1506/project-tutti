import { describe, expect, it } from 'vitest'
import { KeyStore } from '../../../src/main/keys/keyStore'
import { openStore } from '../../../src/main/store/db'

// Cifra de mentira: inverte o texto (o real é o safeStorage do Electron, preso ao Keychain).
const fake = (ok = true) => ({
  isAvailable: () => ok,
  encrypt: (s: string) => Buffer.from([...s].reverse().join(''), 'utf8'),
  decrypt: (b: Buffer) => [...b.toString('utf8')].reverse().join(''),
})

describe('KeyStore', () => {
  it('chave cifrada no banco, nunca em texto puro', () => {
    const store = openStore(':memory:')
    const ks = new KeyStore({ store, crypto: fake() })
    ks.set('openrouter', 'sk-or-123')
    expect(JSON.stringify(store.getSetting('key:openrouter'))).not.toContain('sk-or-123')
    expect(ks.get('openrouter')).toBe('sk-or-123')
    expect(ks.which()).toEqual({ openrouter: true, moonshotai: false, openai: false, anthropic: false, google: false, deepseek: false })
    expect(ks.all()).toEqual({ openrouter: 'sk-or-123' })
  })
  it('remover apaga a chave', () => {
    const store = openStore(':memory:')
    const ks = new KeyStore({ store, crypto: fake() })
    ks.set('openai', 'sk-1'); ks.remove('openai')
    expect(ks.get('openai')).toBeUndefined()
    expect(store.getSetting('key:openai')).toBeUndefined()
  })
  it('sem Keychain: recusa salvar', () => {
    const ks = new KeyStore({ store: openStore(':memory:'), crypto: fake(false) })
    expect(() => ks.set('openai', 'x')).toThrow('KEYCHAIN_UNAVAILABLE')
  })
  it('chave que não decifra (Keychain trocado) vale como ausente', () => {
    const store = openStore(':memory:')
    new KeyStore({ store, crypto: fake() }).set('google', 'g-1')
    const broken = new KeyStore({ store, crypto: { ...fake(), decrypt: () => { throw new Error('bad') } } })
    expect(broken.get('google')).toBeUndefined()
    expect(broken.which().google).toBe(false)
  })
})
