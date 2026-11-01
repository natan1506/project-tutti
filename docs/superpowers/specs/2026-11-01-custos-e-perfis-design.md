# Tutti — Custos e Perfis de agentes — documento de design

**Data:** 2026-11-01 · **Autor:** Natan Souza (decisões) · **Base:** `2026-10-30-time-de-agentes-design.md` (Fases 1, 2, 3A e 3B na main)

## 1. Intenção e porquê

Um amigo do Natan, que trabalha com orquestração, quer **medir o custo** do vai e volta entre agentes: quanto cada um gasta, quanto falta para o limite, e ter **gatilhos** quando o gasto passa do ponto. Ao mesmo tempo, Natan quer **sair do time fixo**: montar perfis próprios, com agentes que ele define (nome, prompt) e que rodam por **CLI ou por API** de vários provedores (OpenRouter, Kimi, GPT, Claude, Gemini…).

Sucesso: Natan bate o olho no canto da tela e sabe quanto de cada assinatura já foi; quando uma está acabando, o Tutti avisa e oferece passar o trabalho; e ele consegue montar um perfil do zero, com modelos por API, falando com cada agente direto, e cada um sabendo o que os outros já disseram na conversa.

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos**
1. **Painel de uso** fixo no canto inferior direito.
2. **Gatilho de limite:** avisar e perguntar se pode passar o trabalho; se sim, passa.
3. **Perfis de agentes:** o "Padrão" (o time de hoje) + perfis criados do zero.
4. **Modo API** por agente (ou herdado do perfil), com chave do Natan.
5. **Contexto compartilhado** na conversa: qualquer agente chamado sabe o que já foi dito, por quem.

**Não-objetivos (agora)**
- Valor em dinheiro para quem usa assinatura (decidido: "vemos isso lá para frente").
- Valor em dinheiro no modo API também fica para depois; nesta fase o modo API mostra só tokens.
- Mascotes/cores escolhidos à mão; personagens novos.
- Sincronizar perfis entre máquinas, exportar/importar perfis.

**Anti-objetivos**
- Chave de API em arquivo do projeto, em log, no banco em texto puro ou no `env` de agentes CLI.
- Usar API paga **sem o Natan ter escolhido** explicitamente aquele agente/perfil em modo API. O perfil Padrão continua 100% assinatura.
- Passar trabalho para outro agente **sem perguntar**.
- Agente por API com menos segurança que os de CLI (sem aprovação de comandos).

## 3. Restrições

- Mesma base: Electron + React + Three.js; adaptadores existentes (Claude SDK, Codex SDK, Antigravity `agy`, opencode via HTTP próprio).
- Política de comandos §6.4 vale para **todo** agente, em qualquer perfil e transporte.
- Spec original §2 dizia "sem API cobrada por uso": **revisto** — continua valendo para o perfil Padrão; o modo API é opção explícita do Natan por agente/perfil.

## 4. Painel de uso (decidido)

- **Onde:** canto inferior direito do palco, pequeno, recolhível (estado lembrado).
- **Uma linha por ferramenta/provedor em uso no perfil ativo** (ex.: Claude Code, Codex, Antigravity, opencode; no modo API, uma linha por provedor+modelo).
- **Cada linha:** nome · **barra fina na cor do agente** (se mais de um agente usa a mesma ferramenta, a cor do primeiro do perfil) · **porcentagem** do limite da sessão já usada · **tokens enviados / recebidos** da sessão.
- **De onde vem a porcentagem (Natan confirmou: limite da assinatura por sessão):**
  - Claude: dado oficial (o SDK expõe janelas de limite do plano com `utilization`; ver §9). **A barra mostra a janela de 5 horas** (a "sessão"); o detalhe mostra também as semanais. O gatilho dispara pela **janela mais usada** (5 h ou semanal), dizendo qual (minha escolha).
  - Tokens da linha zeram junto com a janela de 5 h da ferramenta; onde não há janela (estimativa, modo API), zeram à meia-noite (minha escolha).
  - Demais CLIs: o que a ferramenta informar; onde não houver número oficial, **estimativa** pelo histórico de tokens do próprio Natan, com a linha marcada "estimado".
  - Modo API: não há "limite da sessão"; a linha mostra só tokens (sem barra), até a fase de dinheiro.
- **Clicar no painel** abre o detalhe: tokens por agente e por pedido (a conversa atual), e histórico por dia/projeto (minha escolha — ver §11).

## 5. Gatilho de limite (decidido)

- Limite de alerta configurável (padrão **90%**, minha escolha), geral e por ferramenta.
- Ao cruzar o limite **com um pedido rodando naquela ferramenta**: aviso no chat do pedido — "O Claude está em 92% do limite. Posso passar o trabalho do Forja para outro agente?" — com [Passar] [Continuar].
- **Passar:** o trabalho do agente afetado é cancelado e reenviado a outro agente **de ferramenta com folga** no mesmo perfil; quem escolhe é o coordenador do perfil, se houver, ou a regra: agente que escreve se o afetado escreve, ferramenta com mais folga, descrição de função mais próxima (minha escolha). Se não houver ninguém com folga, o aviso diz isso e só oferece [Continuar].
  - **Destino por API paga (decidido pelo Natan):** se o agente que vai receber o trabalho roda por API paga, o aviso diz isso com todas as letras ("O Kimi roda por API paga") e pede confirmação antes de passar; sem confirmação, não passa.
  - **O que já foi feito fica (minha escolha):** as edições do agente cancelado **não** são revertidas; o substituto recebe o pedido, o resumo da conversa (§7) e a lista/diff do que já mudou, e continua dali.
  - Em pedido de time, o substituto assume **o mesmo passo** como novo run-filho do mesmo pedido (mesmo ponto de restauração e diff final); em pedido direto, vira um novo run na mesma conversa.
- **Continuar:** segue; o aviso não se repete naquele pedido.
- Sem pedido rodando: o painel destaca a linha (cor de alerta) e nada mais.

## 6. Perfis (decidido)

- **Perfil "Padrão":** o time atual (Bússola coordenador, Forja, Pincel, Radar, Lupa, Curinga), tudo por CLI/assinatura. Não pode ser apagado **nem editado**; pode ser duplicado para servir de base (minha escolha).
- **Identidade dos agentes (minha escolha):** cada agente de perfil tem um id próprio; as cópias de um perfil duplicado são agentes novos (sessões e, no futuro, cadernos/notas começam do zero). Sessões só são retomadas se o agente continuar no mesmo transporte e modelo; trocar qualquer um dos dois começa sessão nova.
- **Perfis do Natan:** criados **do zero** numa tela de configuração. Cada **agente** tem:
  - nome; **prompt** (o que é e como trabalha); se **só lê** ou pode escrever;
  - **transporte**: CLI (Claude Code, Codex, Antigravity, opencode) ou API (provedor + modelo + chave);
  - modelo (lista do provedor/CLI);
  - **papéis no time** (minha escolha, para a orquestração da Fase 3B funcionar em perfil próprio): uma **descrição curta da função** (usada na triagem; no Padrão é a `funcao` atual), e duas marcações — **"revisa o trabalho"** (faz o papel do Lupa: entra no fim, depois de quem escreve; mais de um = todos revisam) e **"pode ser consultado"** (pode ser chamado no meio do trabalho, como Radar e Lupa hoje; só agentes que só leem). Sem revisor no perfil, não há passo de revisão.
- **Configuração geral do perfil:** transporte, provedor e modelo padrão, que cada agente herda e pode sobrescrever.
- **Coordenador opcional.** Sem coordenador: a aba Time some, só pedidos diretos. Com coordenador: a orquestração da Fase 3B funciona igual, usando o agente marcado.
- **Escalação com agente por API paga (decidido pelo Natan):** se a escalação do coordenador incluir algum agente por API paga, o pedido passa a exigir aprovação do plano (como pedido grande), e o card do plano marca quais passos usam API paga. Recusar = nada roda.
- **Seletor de perfil** no topo, ao lado do projeto; cada projeto lembra o último perfil usado (minha escolha).
- **Mascote = família do modelo (decidido):** Claude → bichinho do Claude; GPT/Codex → nuvem; Gemini → estrela; demais (Kimi, DeepSeek, outros) → bloco do opencode. Cor da família com variação de tom para diferenciar agentes da mesma família lado a lado (minha escolha).
- **Limite prático do palco:** até 8 agentes por perfil (minha escolha; o palco foi feito para 6).

## 7. Contexto compartilhado na conversa (decidido)

- Todo agente chamado numa conversa recebe, antes do pedido, um **resumo do que já aconteceu nela**: pedidos do Natan e respostas de **todos** os agentes (quem disse o quê), em ordem.
- **Entra (minha escolha):** pedidos do Natan, respostas finais em texto de cada agente, perguntas/respostas entre agentes (consultas) e, de pedidos de time, só o resumo da escalação e a lista de arquivos alterados. **Não entra:** notas da triagem, confirmações, passos de ferramenta, diffs completos.
- Exemplo do Natan: pergunta ao agente Claude, depois pede a opinião do agente Gemini sobre aquilo — o Gemini responde sabendo o que o Claude disse.
- Agente que retoma a própria sessão (§5.7.1 do spec original) recebe **só o que ele ainda não viu** (o que os outros disseram desde a última vez dele).
- Conversa longa: entram as últimas trocas por inteiro e as anteriores resumidas, dentro de um teto de tamanho (minha escolha: ~6.000 tokens de contexto compartilhado).
- Vale para todos os perfis, inclusive o Padrão.

## 8. Modo API (decidido o "como", escolha minha)

- Agente em API roda no **motor do opencode** (servidor que o app já sobe), configurado com o provedor, o modelo e a chave do Natan. Motivo: o opencode já fala com OpenRouter, Kimi (Moonshot), OpenAI, Anthropic, Google, DeepSeek e outros, já tem ferramentas de arquivo/comando e já está ligado às aprovações do app (Fase 3A).
- **Chaves:** guardadas no **Keychain do macOS** (via `safeStorage` do Electron ou equivalente), por provedor; nunca em arquivo do projeto, log, banco em texto puro ou `env` de agentes CLI. Só o processo do opencode recebe a chave de que precisa.
- Agentes CLI continuam com a remoção de chaves do ambiente (BLOCKED_ENV) — nada muda para eles.

## 9. Medição de uso (o "como" é do construtor, com estes pontos fixos)

- Cada adaptador passa a emitir um evento de uso por turno: tokens de entrada, saída, cache e raciocínio (os quatro CLIs já entregam isso: Claude no resultado, Codex em `turn.completed.usage`, Antigravity em `step_update.usage`, opencode em `session.step.ended.tokens`).
- **Limite da assinatura:**
  - Claude: consulta de uso do SDK (experimental) que devolve janelas com `utilization` e horário de reset; consultar no fim de cada pedido e a cada poucos minutos com o app aberto (frequência: construtor).
  - Codex, Antigravity: o construtor verifica num spike se há número oficial (ex.: `/status` do Codex); se não, estimativa pelo histórico (média de tokens por janela que já levou o Natan ao limite, ou um teto configurável por ferramenta).
  - opencode com modelos gratuitos: sem limite conhecido — mostra só tokens.
- Tudo gravado no SQLite (por run, por agente, por ferramenta, por dia).

## 10. Decidido pelo Natan × minhas escolhas

**Natan decidiu:** trabalho só vai para agente por API paga (troca por limite ou escalação do coordenador) depois de confirmação explícita, com o aviso deixando claro que é pago; painel no canto inferior direito com barra fina na cor do agente + porcentagem; porcentagem = quanto do limite da sessão da assinatura já foi; junto, tokens enviados/recebidos; gatilho = avisar e perguntar se pode passar o trabalho, se sim passa; sem valor em dinheiro na assinatura (depois); perfis criados do zero pelo usuário, com nome/prompt/CLI ou API por agente e config geral do perfil; coordenador opcional (perfil só com pedidos diretos é válido); contexto compartilhado entre agentes na conversa; mascote pelo modelo.

**Minhas escolhas:** limite de alerta 90% configurável; regra de quem recebe o trabalho passado; detalhe por agente/pedido e histórico por dia/projeto ao clicar no painel; cada projeto lembra o último perfil; até 8 agentes por perfil; variação de tom de cor na mesma família; teto de ~6.000 tokens de contexto compartilhado; modo API pelo motor do opencode; chaves no Keychain; modo API sem barra (só tokens) nesta fase.

## 11. Deixado para o construtor

- Esquema do banco para uso, perfis e agentes; migração do time fixo de `src/shared/agents.ts` para o perfil Padrão.
- Frequência de consulta de uso; formato do resumo de contexto; como estimar limite onde não há número oficial (dentro de §9).
- Layout da tela de configuração de perfis (seguindo o estilo atual).
- Como mapear um agente API para a configuração de provedor do opencode (config inline por sessão ou `OPENCODE_CONFIG_CONTENT`).
