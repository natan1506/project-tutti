import { useEffect, useMemo, useState } from 'react'
import { resolveAgentDefs } from '@shared/profiles'
import { splitCommandLine, type McpMode, type McpServerDef, type McpTransport } from '@shared/mcp'
import { useMcpStore } from '../state/mcpStore'
import { useProfileStore } from '../state/profileStore'

// Janela de MCPs (spec mcps): instalar, importar do Claude Code, testar, escolher quem usa e o que é leitura.

type Form = { nome: string; kind: 'stdio' | 'http'; line: string; secrets: string; mode: McpMode; agents: 'all' | string[] }
const blankForm = (): Form => ({ nome: '', kind: 'stdio', line: '', secrets: '', mode: 'read', agents: 'all' })
const transportText = (t: McpTransport) => (t.kind === 'http' ? t.url : [t.command, ...t.args].join(' '))
const stateText = (d: McpServerDef) => (d.lastError ? 'com erro' : d.enabled ? 'ligado' : 'desligado')

export function McpsScreen() {
  const { list, load, setOpen } = useMcpStore()
  const active = useProfileStore(s => s.active)
  const agents = useMemo(() => (active ? resolveAgentDefs(active) : []), [active])
  const [currentId, setCurrentId] = useState<string>()
  const [form, setForm] = useState<Form>()
  const [importable, setImportable] = useState<{ nome: string; transport: McpTransport }[]>()
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  useEffect(() => { void load() }, [load])
  const current = list.find(d => d.id === currentId)
  const close = () => setOpen(false)

  const run = async (fn: () => Promise<{ ok: boolean; errors?: string[]; def?: McpServerDef } | void>) => {
    setBusy(true); setErrors([])
    try {
      const r = await fn()
      if (r && !r.ok) setErrors(r.errors ?? ['Algo deu errado.'])
      else if (r && r.def) { setCurrentId(r.def.id); setForm(undefined); setImportable(undefined) }
      await load()
    } finally { setBusy(false) }
  }

  const saveForm = () => form && run(async () => {
    const parts = splitCommandLine(form.line)
    const transport: McpTransport = form.kind === 'http' ? { kind: 'http', url: form.line.trim() } : { kind: 'stdio', command: parts[0] ?? '', args: parts.slice(1) }
    const secrets = Object.fromEntries(form.secrets.split('\n').map(l => l.trim()).filter(Boolean).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1)]).filter(([k]) => k))
    return window.time.saveMcp({ def: { id: '', nome: form.nome.trim(), transport, secretNames: Object.keys(secrets), mode: form.mode, agents: form.agents, enabled: true, tools: [] }, secrets })
  })

  const agentChecks = (value: 'all' | string[], set: (v: 'all' | string[]) => void) => (
    <div className="opt-line wrap">
      <label><input type="checkbox" checked={value === 'all'} onChange={e => set(e.target.checked ? 'all' : agents.map(a => a.id))} /> Todos os agentes</label>
      {value !== 'all' && agents.map(a => (
        <label key={a.id}><input type="checkbox" checked={value.includes(a.id)} onChange={e => set(e.target.checked ? [...value, a.id] : value.filter(x => x !== a.id))} /> {a.nome}</label>
      ))}
    </div>
  )

  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal profiles skills mcps" onClick={e => e.stopPropagation()}>
        <div className="row between"><b>MCPs</b><button onClick={close}>Fechar</button></div>
        <div className="profiles-body">
          <aside className="profiles-list">
            {list.map(d => (
              <button key={d.id} className={currentId === d.id && !form ? 'on' : ''} onClick={() => { setForm(undefined); setImportable(undefined); setCurrentId(d.id) }}>
                {d.nome}<small>{stateText(d)} · {d.mode === 'write' ? 'pode escrever' : 'só leitura'}</small>
              </button>
            ))}
            <button className="menu-action" disabled={busy} onClick={() => { setImportable(undefined); setForm(blankForm()) }}>Adicionar MCP</button>
            <button className="menu-action" disabled={busy} onClick={() => { setForm(undefined); void window.time.mcpImportable().then(setImportable) }}>Importar do Claude Code</button>
          </aside>
          <section className="profile-edit">
            {errors.length > 0 && <div className="errors">{errors.map(e => <p key={e}>{e}</p>)}</div>}
            {importable && (
              <>
                <h4>Do seu Claude Code</h4>
                {importable.length ? importable.map(i => (
                  <div key={i.nome} className="opt-line wrap">
                    <b>{i.nome}</b><small className="muted">{transportText(i.transport)}</small>
                    <button aria-label={`Importar ${i.nome}`} disabled={busy} onClick={() => void run(() => window.time.importMcp(i.nome))}>Importar</button>
                  </div>
                )) : <p className="muted">Nada novo para importar: tudo que está no Claude Code já está aqui.</p>}
                <p className="muted">Entra como só leitura, para todos os agentes. O Playwright entra desligado: os agentes Claude já usam o navegador do Tutti.</p>
              </>
            )}
            {form && (
              <>
                <h4>Novo MCP</h4>
                <div className="opt-line wrap">
                  <label>Nome <input aria-label="Nome" value={form.nome} maxLength={40} placeholder="linear" onChange={e => setForm({ ...form, nome: e.target.value })} /></label>
                  <label>Tipo <select aria-label="Tipo" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as Form['kind'] })}><option value="stdio">Comando</option><option value="http">URL</option></select></label>
                </div>
                <label className="block">{form.kind === 'http' ? 'URL' : 'Comando'}
                  <input aria-label={form.kind === 'http' ? 'URL' : 'Comando'} className="wide" value={form.line} placeholder={form.kind === 'http' ? 'https://mcp.exemplo.com/mcp' : 'npx -y mcp-remote https://mcp.linear.app/mcp'} onChange={e => setForm({ ...form, line: e.target.value })} />
                </label>
                <label className="block">Variáveis secretas (uma por linha, NOME=valor; vão para o Keychain)
                  <textarea aria-label="Variáveis secretas" rows={2} value={form.secrets} onChange={e => setForm({ ...form, secrets: e.target.value })} />
                </label>
                <div className="opt-line wrap">
                  <label><input type="radio" checked={form.mode === 'read'} onChange={() => setForm({ ...form, mode: 'read' })} /> Só leitura</label>
                  <label><input type="radio" checked={form.mode === 'write'} onChange={() => setForm({ ...form, mode: 'write' })} /> Pode escrever (só agentes Claude, com sua aprovação a cada uso)</label>
                </div>
                {agentChecks(form.agents, agentsV => setForm({ ...form, agents: agentsV }))}
                <p className="muted">Ao salvar, o Tutti roda esse comando para conectar e listar as ferramentas.</p>
                <button className="primary" disabled={busy || !form.nome.trim() || !form.line.trim()} onClick={() => void saveForm()}>{busy ? 'Testando…' : 'Salvar e testar'}</button>
              </>
            )}
            {!form && !importable && current && (
              <>
                <div className="row between">
                  <h4>{current.nome}</h4>
                  <label><input type="checkbox" checked={current.enabled} disabled={busy} onChange={e => void run(() => window.time.setMcpEnabled({ id: current.id, enabled: e.target.checked }))} /> Ligado</label>
                </div>
                <p className="muted mono">{transportText(current.transport)}</p>
                {current.lastError && <p className="error">Não conectou: {current.lastError}</p>}
                <p className="muted">{current.mode === 'write' ? 'Pode escrever. ' : 'Só leitura. '}Escrita só nos agentes Claude, e cada uso pede a sua aprovação. Codex e opencode recebem só as ferramentas de leitura.</p>
                <div className="mcp-tools">
                  {(['read', 'write'] as const).map(side => (
                    <div key={side}>
                      <h5>{side === 'read' ? 'Leitura' : 'Escrita'}</h5>
                      {current.tools.filter(t => t.read === (side === 'read')).map(t => (
                        <div key={t.name} className="opt-line">
                          <code>{t.name}</code>
                          <button aria-label={`Mover ${t.name} para ${side === 'read' ? 'escrita' : 'leitura'}`} disabled={busy}
                            onClick={() => void run(() => window.time.setMcpTool({ id: current.id, tool: t.name, read: side !== 'read' }))}>{side === 'read' ? '→' : '←'}</button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="opt-line wrap">
                  <button disabled={busy} onClick={() => void run(() => window.time.retestMcp(current.id))}>{busy ? 'Testando…' : 'Testar de novo'}</button>
                  <button disabled={busy} onClick={() => { void run(() => window.time.removeMcp(current.id)); setCurrentId(undefined) }}>Remover</button>
                </div>
              </>
            )}
            {!form && !importable && !current && <p className="muted">Escolha um MCP, adicione um novo ou importe do seu Claude Code.</p>}
          </section>
        </div>
      </div>
    </div>
  )
}
