import { useEffect, useState } from 'react'
import { resolveAgentDefs } from '@shared/profiles'
import { VOICE_SOURCE_LABEL, VOICE_SOURCES, type VoiceChoice, type VoiceOption, type VoiceSource, type VoiceSourceStatus } from '@shared/voice'
import { agentColor } from '../stage/colors'
import { useProfileStore } from '../state/profileStore'
import { playAudio } from '../state/voicePlayer'
import { useVoiceStore } from '../state/voiceStore'

// Tela Vozes… (design §6.3): estado das três fontes e a voz de cada agente de todos os perfis.

const fmt = (n: number) => n.toLocaleString('pt-BR')

export function VoicesScreen() {
  const { profiles } = useProfileStore()
  const { setOpen, elevenAck } = useVoiceStore()
  const [status, setStatus] = useState<VoiceSourceStatus>()
  const [lists, setLists] = useState<Partial<Record<VoiceSource, VoiceOption[]>>>({})
  const [choices, setChoices] = useState<Record<string, VoiceChoice>>({})
  const [pendingEleven, setPendingEleven] = useState<string>()
  const [key, setKey] = useState('')
  const [allMac, setAllMac] = useState(false)
  const [playing, setPlaying] = useState<string>()

  const agents = profiles.flatMap(p => resolveAgentDefs(p).map(d => ({ ...d, profile: p.nome })))

  async function loadList(source: VoiceSource, all = allMac): Promise<VoiceOption[]> {
    const l = await window.time.voiceList({ source, all })
    setLists(s => ({ ...s, [source]: l }))
    return l
  }
  const refresh = () => window.time.voiceStatus().then(setStatus)

  useEffect(() => {
    void refresh()
    void loadList('macos')
    for (const a of agents) {
      window.time.voiceChoice(a.id).then(c => {
        setChoices(cs => ({ ...cs, [a.id]: c }))
        if (c.source !== 'macos') void loadList(c.source)
      }, e => console.warn('voz do agente', a.id, e))
    }
  }, [profiles])

  async function choose(agentId: string, choice: VoiceChoice) {
    setChoices(c => ({ ...c, [agentId]: choice }))
    await window.time.setVoice({ agentId, choice })
  }

  async function changeSource(agentId: string, source: VoiceSource, ack = elevenAck) {
    if (source === 'elevenlabs' && !ack) { setPendingEleven(agentId); return }
    const list = lists[source] ?? await loadList(source)
    if (!list.length) { setChoices(c => ({ ...c, [agentId]: { source, voiceId: '' } })); return }
    await choose(agentId, { source, voiceId: list[0].id })
  }

  async function preview(a: { id: string; nome: string; funcao: string }) {
    setPlaying(a.id)
    try {
      const r = await window.time.synthesize({ agentId: a.id, text: `Oi, eu sou o ${a.nome}. ${a.funcao}`.slice(0, 200), name: a.nome })
      if (r.notice) useVoiceStore.setState({ notice: r.notice })
      await playAudio(r)
    } finally { setPlaying(undefined) }
  }

  const credits = status?.elevenlabs.credits
  let lastProfile = ''
  return (
    <div className="modal-bg" onClick={() => setOpen(false)}>
      <div className="modal profiles voices" onClick={e => e.stopPropagation()}>
        <div className="row between"><b>Vozes</b><button onClick={() => setOpen(false)}>Fechar</button></div>
        <p className="section-help">Cada agente fala só o que pede atenção: aprovação, pergunta, plano pronto, fim do pedido, limite e erro. Nunca código nem passos.</p>
        <div className="voice-sources">
          <div className="voice-source"><b>macOS</b><span className="ok">Pronto · grátis, fica no Mac</span>
            <label className="small"><input type="checkbox" checked={allMac} onChange={e => { setAllMac(e.target.checked); void loadList('macos', e.target.checked) }} /> Mostrar todas</label></div>
          <div className="voice-source"><b>VoiceStudio</b>
            {status?.voicestudio ? <span className="ok">Aberto · grátis, fica no Mac</span> : <span className="muted">Abra o VoiceStudio para usar estas vozes</span>}
            <button className="link" onClick={() => void refresh()}>Verificar de novo</button></div>
          <div className="voice-source"><b>ElevenLabs</b>
            {status?.elevenlabs.hasKey ? (
              <>
                <span className="ok">{credits ? `${fmt(credits.limit - credits.used)} de ${fmt(credits.limit)} créditos${credits.resetsAt ? ` · renova em ${new Date(credits.resetsAt).toLocaleDateString('pt-BR')}` : ''}` : 'Chave salva'}</span>
                <button className="link" onClick={async () => { await window.time.removeVoiceKey(); await refresh() }}>Remover chave</button>
              </>
            ) : (
              <span className="key-inline">
                <input aria-label="Chave da ElevenLabs" type="password" placeholder="cole a chave" value={key} onChange={e => setKey(e.target.value)} />
                <button disabled={key.length < 8} onClick={async () => { await window.time.setVoiceKey(key); setKey(''); useVoiceStore.setState({ elevenAck: true }); await refresh() }}>Salvar</button>
                <small className="paid-note">O texto falado vai para a ElevenLabs. Plano grátis: 10 mil créditos por mês.</small>
              </span>
            )}
          </div>
        </div>
        {pendingEleven && (
          <div className="confirm eleven-confirm">
            Ao usar a ElevenLabs, o texto falado vai para a ElevenLabs e cada fala gasta créditos (1 por caractere).{' '}
            <button className="primary" onClick={() => { const id = pendingEleven; setPendingEleven(undefined); useVoiceStore.setState({ elevenAck: true }); void changeSource(id, 'elevenlabs', true) }}>Usar ElevenLabs</button>
            <button onClick={() => setPendingEleven(undefined)}>Cancelar</button>
          </div>
        )}
        <div className="voice-list">
          {agents.map(a => {
            const c = choices[a.id]
            const list = c ? lists[c.source] ?? [] : []
            const header = a.profile !== lastProfile ? <h4 key={`h-${a.profile}`}>{(lastProfile = a.profile)}</h4> : null
            return [header, (
              <div key={a.id} className="voice-row">
                <i className="agent-dot" style={{ background: agentColor(a) }} />
                <b>{a.nome}</b>
                <select aria-label={`Fonte do ${a.nome}`} value={c?.source ?? 'macos'} onChange={e => void changeSource(a.id, e.target.value as VoiceSource)}>
                  {VOICE_SOURCES.map(s => <option key={s} value={s}>{VOICE_SOURCE_LABEL[s]}</option>)}
                </select>
                <select aria-label={`Voz do ${a.nome}`} value={c?.voiceId ?? ''} disabled={!list.length} onChange={e => void choose(a.id, { source: c!.source, voiceId: e.target.value })}>
                  {!list.length && <option value="">{!c || c.source === 'macos' ? 'carregando…' : 'indisponível'}</option>}
                  {list.map(v => <option key={v.id} value={v.id}>{v.name}{v.lang && v.lang !== 'pt_BR' ? ` (${v.lang})` : ''}</option>)}
                </select>
                <button disabled={playing !== undefined} onClick={() => void preview(a)}>{playing === a.id ? 'Falando…' : '▶ Ouvir'}</button>
                {c?.source === 'elevenlabs' && <small className="paid-note">gasta ~{(`Oi, eu sou o ${a.nome}. ${a.funcao}`).slice(0, 200).length} créditos</small>}
              </div>
            )]
          })}
        </div>
      </div>
    </div>
  )
}
