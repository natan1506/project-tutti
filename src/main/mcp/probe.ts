import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpServerDef } from '@shared/mcp'
import { safeEnv } from '../adapters/env'

// Teste de um MCP (spec mcps §2): conecta, lista as ferramentas e fecha. Nunca lança: erro vira { ok: false }.

export type ProbeResult = { ok: true; tools: { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }[] } | { ok: false; error: string }

export async function probeMcp(def: McpServerDef, secrets: Record<string, string>, timeoutMs = 60_000): Promise<ProbeResult> {
  const client = new Client({ name: 'tutti', version: '1.0.0' })
  const transport = def.transport.kind === 'stdio'
    ? new StdioClientTransport({ command: def.transport.command, args: def.transport.args, env: { ...safeEnv(), ...secrets }, stderr: 'ignore' })
    : new StreamableHTTPClientTransport(new URL(def.transport.url))
  let timer: NodeJS.Timeout | undefined
  try {
    const work = (async () => {
      await client.connect(transport)
      const { tools } = await client.listTools()
      return tools.map(t => ({ name: t.name, ...(t.annotations ? { annotations: t.annotations as { readOnlyHint?: boolean; destructiveHint?: boolean } } : {}) }))
    })()
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`não respondeu em ${Math.round(timeoutMs / 1000)} s`)), timeoutMs) })
    return { ok: true, tools: await Promise.race([work, timeout]) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
    await client.close().catch(() => {})
  }
}
