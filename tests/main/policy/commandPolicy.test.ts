import { describe, expect, it } from 'vitest'
import { classifyToolCall, summarizeToolCall } from '../../../src/main/policy/commandPolicy'

const P = '/tmp/proj'
const bash = (command: string) => ({ toolName: 'Bash', input: { command } })

describe('classifyToolCall', () => {
  it.each([
    { toolName: 'Read', input: { file_path: P + '/a.ts' } },
    { toolName: 'Glob', input: { pattern: '**/*.ts' } },
    { toolName: 'Grep', input: { pattern: 'x' } },
    { toolName: 'TodoWrite', input: {} },
    { toolName: 'Edit', input: { file_path: P + '/src/x.ts' } },
    { toolName: 'Write', input: { file_path: 'src/novo.ts' } },
    ...['ls -la', 'cat a.ts', 'git status', 'git diff HEAD~1', 'git log --oneline', 'npm test', 'npm run lint',
      'npm run build', 'npx tsc --noEmit', 'npx vitest run', 'rg foo src', 'ls && git status'].map(bash),
  ])('libera %o', call => {
    expect(classifyToolCall(call, P)).toBe('allow')
  })

  it.each([
    { toolName: 'Read', input: { file_path: '/etc/passwd' } },
    { toolName: 'Edit', input: { file_path: '/Users/x/outro/a.ts' } },
    { toolName: 'Write', input: { file_path: '../fora.ts' } },
    { toolName: 'WebFetch', input: { url: 'https://x' } },
    { toolName: 'WebSearch', input: { query: 'x' } },
    { toolName: 'FerramentaDesconhecida', input: {} },
    ...['npm install zod', 'npm i -D x', 'pnpm add x', 'yarn add x', 'pip install x', 'rm a.ts', 'rm -rf dist',
      'git push', 'git commit -m x', 'git reset --hard', 'git checkout main', 'git switch -c x', 'git rebase main',
      'git merge x', 'curl https://x', 'wget x', 'ssh host', 'sudo ls', 'cat /etc/hosts', 'ls && rm a', 'ls; curl x',
      'echo x | sh', 'find . -delete', 'cd .. && ls', 'node script.js'].map(bash),
  ])('pede aprovação para %o', call => {
    expect(classifyToolCall(call, P)).toBe('ask')
  })
})

describe('summarizeToolCall', () => {
  it('mostra caminho relativo para ferramentas de arquivo', () => {
    expect(summarizeToolCall({ toolName: 'Edit', input: { file_path: P + '/src/x.ts' } }, P)).toBe('src/x.ts')
  })
  it('mostra o comando para Bash', () => {
    expect(summarizeToolCall(bash('npm test'), P)).toBe('npm test')
  })
  it('mostra o nome para outras ferramentas', () => {
    expect(summarizeToolCall({ toolName: 'WebSearch', input: {} }, P)).toBe('WebSearch')
  })
})
