// MCP falso para testes: get_thing (leitura) e save_thing (escrita); get_secret devolve a variável FAKE_TOKEN.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({ name: 'fake', version: '0.0.1' })
server.tool('get_thing', 'lê uma coisa', async () => ({ content: [{ type: 'text', text: 'coisa' }] }))
server.tool('save_thing', 'grava uma coisa', async () => ({ content: [{ type: 'text', text: 'gravado' }] }))
server.tool('get_secret', 'devolve o segredo', async () => ({ content: [{ type: 'text', text: process.env.FAKE_TOKEN ?? '' }] }))
await server.connect(new StdioServerTransport())
