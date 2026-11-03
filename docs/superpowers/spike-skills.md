# Spike — skills como plugin local do Agent SDK (2026-11-03)

**Pergunta:** o `@anthropic-ai/claude-agent-sdk` 0.3.314 carrega uma skill de um plugin local em pasta do app, com `settingSources: []` (sem ler `~/.claude` nem o projeto)? Qual o nome dela?

**Como:** `node scripts/spike/claude-skill-plugin.mjs` cria numa pasta temporária `.claude-plugin/plugin.json` (`{"name":"tutti"}`) e `skills/ola-mundo/SKILL.md`, abre `query()` com `plugins: [{type:'local', path}]` e `skills: ['tutti:ola-mundo']`, e lê `supportedCommands()` sem mandar mensagem ao modelo (não gasta limite).

**Saída:**

```
comandos com "ola": [ 'tutti:ola-mundo — (tutti) Use quando pedirem um olá.' ]
total de comandos: 55
```

**Conclusão:** funciona. O nome qualificado é `tutti:<name>`, que é o que vai em `skills`. A descrição do frontmatter é o que o modelo vê para decidir quando usar.

**Codex e os outros:** o Codex 0.166 só descobre skills em `$CODEX_HOME/skills`, `.agents/skills` e `.codex/skills` (pastas globais ou do projeto); `skills.config` só liga/desliga as já descobertas. Para não escrever nessas pastas, Codex, Antigravity e opencode recebem as skills nas instruções (plano, Design §6).
