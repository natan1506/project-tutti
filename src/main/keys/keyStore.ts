import { PROVIDERS, type ProviderId } from '@shared/profiles'
import type { Store } from '../store/db'

// Chaves de API por provedor (spec custos-e-perfis §8): cifradas pelo Keychain do macOS (safeStorage),
// guardadas como texto cifrado no banco. Só o processo principal lê; a interface só sabe quais existem.

export interface KeyCrypto {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(cipher: Buffer): string
}

export class KeyStore {
  constructor(private deps: { store: Store; crypto: KeyCrypto }) {}

  set(provider: ProviderId, key: string): void {
    if (!this.deps.crypto.isAvailable()) throw new Error('KEYCHAIN_UNAVAILABLE')
    this.deps.store.setSetting(`key:${provider}`, this.deps.crypto.encrypt(key).toString('base64'))
  }

  remove(provider: ProviderId): void {
    this.deps.store.deleteSetting(`key:${provider}`)
  }

  get(provider: ProviderId): string | undefined {
    const b64 = this.deps.store.getSetting<string>(`key:${provider}`)
    if (!b64) return undefined
    try {
      return this.deps.crypto.decrypt(Buffer.from(b64, 'base64'))
    } catch {
      // Keychain trocado ou item apagado: a chave não serve mais.
      return undefined
    }
  }

  /** Quais provedores têm chave (o que a interface pode saber). */
  which(): Record<ProviderId, boolean> {
    return Object.fromEntries(PROVIDERS.map(p => [p.id, this.get(p.id) !== undefined])) as Record<ProviderId, boolean>
  }

  /** Todas as chaves salvas, para o servidor do opencode. */
  all(): Partial<Record<ProviderId, string>> {
    const out: Partial<Record<ProviderId, string>> = {}
    for (const p of PROVIDERS) {
      const k = this.get(p.id)
      if (k !== undefined) out[p.id] = k
    }
    return out
  }
}
