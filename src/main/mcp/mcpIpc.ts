import { z } from 'zod'
import type { McpServerDef } from '@shared/mcp'
import type { McpService } from './mcpService'

// Handlers dos MCPs (spec mcps §2), separados do ipc.ts para serem testáveis sem Electron.
// Segredos só entram (saveMcp): nenhuma resposta devolve valor de segredo.

const saveInput = z.object({
  def: z.unknown(),
  secrets: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(5000)).refine(r => Object.keys(r).length <= 20).optional(),
})
const toolInput = z.object({ id: z.string().max(100), tool: z.string().max(200), read: z.boolean() })
const enabledInput = z.object({ id: z.string().max(100), enabled: z.boolean() })
const accessInput = z.object({ id: z.string().max(100), mode: z.enum(['read', 'write']), agents: z.union([z.literal('all'), z.array(z.string().max(80)).max(50)]) })
const id = z.string().min(1).max(100)

export function mcpHandlers(svc: McpService) {
  return {
    mcps: (): McpServerDef[] => svc.all(),
    async saveMcp(raw: unknown) {
      const p = saveInput.safeParse(raw)
      if (!p.success) return { ok: false as const, errors: ['Pedido inválido.'] }
      return svc.save(p.data.def, p.data.secrets ?? {})
    },
    removeMcp: (raw: unknown) => svc.remove(id.parse(raw)),
    setMcpTool(raw: unknown) { const p = toolInput.parse(raw); svc.setTool(p.id, p.tool, p.read) },
    setMcpEnabled(raw: unknown) { const p = enabledInput.parse(raw); svc.setEnabled(p.id, p.enabled) },
    setMcpAccess(raw: unknown) { const p = accessInput.parse(raw); svc.setAccess(p.id, p.mode, p.agents) },
    mcpImportable: () => svc.importableFromClaudeCode(),
    importMcp: (raw: unknown) => svc.importFromClaudeCode(z.string().max(40).parse(raw)),
    /** Testa de novo com os segredos já guardados; volta ligado se conectar. */
    async retestMcp(raw: unknown) {
      const def = svc.all().find(d => d.id === id.parse(raw))
      if (!def) return { ok: false as const, errors: ['MCP não encontrado.'] }
      return svc.save({ ...def, enabled: true }, {})
    },
  }
}
