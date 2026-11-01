import { useEffect, useState } from 'react'
import { PROVIDERS, type ProviderId } from '@shared/profiles'

/** Chaves de API por provedor (spec custos-e-perfis §8): a interface só sabe se existe; o valor nunca volta do app. */
export function KeysSection() {
  const [has, setHas] = useState<Partial<Record<ProviderId, boolean>>>({})
  const [draft, setDraft] = useState<Partial<Record<ProviderId, string>>>({})
  const [error, setError] = useState<string>()
  const reload = async () => setHas(await window.time.providerKeys())
  useEffect(() => { void reload() }, [])

  async function save(id: ProviderId) {
    const key = draft[id]?.trim()
    if (!key) return
    setError(undefined)
    try {
      await window.time.setProviderKey(id, key)
      setDraft(d => ({ ...d, [id]: '' }))
      await reload()
    } catch (e) {
      setError(/KEYCHAIN_UNAVAILABLE/.test(String(e)) ? 'O Keychain do macOS não está disponível; a chave não foi salva.' : 'Não consegui salvar a chave.')
    }
  }

  async function remove(id: ProviderId) {
    await window.time.removeProviderKey(id)
    await reload()
  }

  return (
    <section className="keys">
      <h4>Chaves de API</h4>
      <p className="note">Ficam no Keychain do macOS e só o motor do opencode as recebe.</p>
      {PROVIDERS.map(p => (
        <div key={p.id} className="key-row">
          <span>{p.nome}</span>
          {has[p.id] ? (
            <>
              <em>Chave salva</em>
              <button onClick={() => void remove(p.id)}>Remover</button>
            </>
          ) : (
            <>
              <input type="password" aria-label={`Chave da ${p.nome}`} placeholder="cole a chave" autoComplete="off"
                value={draft[p.id] ?? ''} onChange={e => setDraft(d => ({ ...d, [p.id]: e.target.value }))} />
              <button onClick={() => void save(p.id)} disabled={!draft[p.id]?.trim()}>Salvar</button>
            </>
          )}
        </div>
      ))}
      {error && <p className="err">{error}</p>}
    </section>
  )
}
