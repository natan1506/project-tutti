# Time de Agentes — documento de design

**Data:** 2026-10-30 · **Autor:** Natan Souza (decisões) · nome do app provisório: **"Time"**
**Mockup de referência:** [`docs/mockups/tela-principal.html`](../../mockups/tela-principal.html) — abrir no navegador e clicar em "▶ Simular pedido". Os mascotes desse mockup foram **aprovados** como direção visual.

Inspiração: post do Fernando Nogueira no LinkedIn sobre o "Estúdio" (painel em que um time de agentes de IA de empresas diferentes decide entre si quem assume cada pedido). Copiamos a estrutura e o fluxo; nome, agentes e implementação são nossos.

---

## 1. Intenção e porquê

Natan usa Claude Code, Codex, Gemini CLI e às vezes opencode. Hoje ele é o "gerente de projeto" entre eles: copia resposta de um para o outro, compara, volta. Cada ferramenta é boa numa coisa e nenhuma conhece as outras.

O app centraliza tudo: **ele fala uma vez, e um time de agentes — cada um rodando numa dessas ferramentas — decide quem assume, trabalha direto na pasta do projeto, se revisa entre si, e aprende com as próprias notas.** O uso principal é **programar**.

Sucesso = Natan abre o app em vez de abrir os CLIs separadamente no dia a dia, e confia no resultado o suficiente para "Manter tudo" na maioria dos pedidos.

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos (v1)**
- App desktop local com o palco de mascotes 3D animados + chat lateral (layout do mockup).
- Elenco fixo de 6 agentes em 4 ferramentas (seção 4).
- Fluxo completo: triagem → confirmação → escalação → (plano, se grande) → execução → testes/correção → revisão → diff → notas.
- Agentes trabalham direto na pasta escolhida, com ponto de restauração e desfazer.
- Memória de projeto + caderno de lições por agente + nota por pedido, que realimentam o comportamento.

**Não-objetivos (ficam para depois)**
- Voz; deploy automático para VPS; criar/editar agentes pelo painel ou pelo Bússola; distribuir o app para outras pessoas (inclusive instalador assinado, auto-update); app web.

**Anti-objetivos (falhou mesmo que "funcione")**
- Usar API cobrada por uso. **Tudo roda nas assinaturas que Natan já paga**, via os CLIs/SDKs logados localmente.
- Um agente apagar/estragar trabalho do Natan sem possibilidade de desfazer.
- Mascotes "genéricos": o charme do app é o 3D animado e reconhecível; uma UI sem eles não é o produto.
- Gastar o limite das assinaturas em cerimônia (ex.: consultar os 6 agentes de verdade em todo pedido).
- Caderno de lições que cresce sem controle e piora o contexto dos agentes.

## 3. Restrições

- **Plataforma:** Electron (decidido). macOS é a máquina do Natan; não precisa rodar em outros SOs na v1, mas não feche portas sem motivo.
- **Sem chave de API.** Autenticação = sessão já logada de cada CLI na máquina.
- Natan é dev Node/React/Next — stack em TypeScript.
- Uma pessoa, uma máquina, uso pessoal.

## 4. Elenco (decidido)

Elenco **fixo**; a escalação por pedido e o modelo usado são **dinâmicos**. Mascote = identidade visual da ferramenta em que o agente roda, com variação por função (como no mockup).

| Agente | Função | Ferramenta | Mascote |
|---|---|---|---|
| **Bússola** | Coordena: triagem, escalação, escolha de modelo, plano, notas, consolidação de lições | Claude Code | Bichinho laranja do Claude, com bracinhos |
| **Forja** | Back-end, APIs, banco, testes | Claude Code | Bichinho do Claude mais escuro, orelhas, olhos `> <` |
| **Pincel** | Front-end, UI, acessibilidade | Claude Code | Bichinho do Claude cor de areia, orelhas |
| **Radar** | Pesquisa (docs oficiais, referências) | Gemini CLI | Estrela de 4 pontas com gradiente azul→roxo→rosa, flutuando |
| **Lupa** | Code review | Codex | Nuvem azul com tela de terminal no rosto + corpinho |
| **Curinga** | Tarefas gerais / modelos alternativos | opencode | Bloco escuro com moldura quadrada e tela no rosto, antena |

Observação: os visuais usam a identidade das marcas das ferramentas — OK para uso pessoal e para mostrar no LinkedIn; se um dia o app for distribuído, trocar por personagens próprios.

## 5. Fluxo de um pedido

### 5.1 Entrada
- Campo de pedido com abas: **Time** (padrão) ou um agente específico.
- **Aba de agente específico pula a rodada**: vai direto para ele.
- Botão/opção **"rodada completa"**: consulta os 6 de verdade (para pedidos grandes, quando Natan quiser).

### 5.2 Rodada de propostas — modelo "equilíbrio" (decidido)
1. **Triagem (1 chamada, Bússola):** lê o pedido + memória do projeto + funções e médias de nota dos agentes; devolve para **cada** agente: nota de confiança (0–100%), uma frase curta "na voz" do agente, e a escalação candidata (2–3 agentes) com modelo sugerido. Quem fica muito abaixo é descartado aqui (a frase deles foi escrita pelo Bússola — aceitável).
2. **Confirmação real (só candidatos, em paralelo):** cada candidato é consultado na própria ferramenta, com modelo barato e resposta curta e estruturada: `assumo` / `assumo, mas preciso de <agente> para <x>` / `não é comigo, é do <agente>`. A frase exibida é a dele.
3. **Escalação final (Bússola):** ajusta com base nas respostas; define ordem (sequência ou paralelo — ver 6.2) e modelo de cada um.

Na tela: todos "pensando" → barras de proposta com % e frases → mensagem do Bússola com a escalação (chips "→ Forja", "→ Pincel"...).

### 5.3 Plano (só para pedidos grandes — decidido)
- O Bússola classifica o pedido como pequeno ou grande. Grande = vai mexer em vários arquivos ou em algo estrutural (dependências, configuração, schema de banco, organização de pastas). Limiar exato: escolha do construtor (sugestão: > 3 arquivos previstos ou qualquer item estrutural).
- Grande → Bússola mostra o plano (quem faz o quê, em quais arquivos) e **espera "pode ir"** do Natan (pode editar/recusar).
- Pequeno → segue direto.
- Natan pode forçar plano num pedido pequeno (minha escolha: um toggle no campo de pedido).

### 5.4 Execução
- Cada agente escalado roda na sua ferramenta, na pasta do projeto, com o modelo escolhido, lendo antes a memória do projeto e o próprio caderno de lições.
- Balão de fala acima do mascote com o que está fazendo; card recolhível no chat ("Forja está trabalhando · 3 passos"), que expande os passos (comandos, arquivos editados).
- **Um agente pode chamar outro durante o trabalho** (ex.: Forja pede ao Radar para checar a documentação de uma API) sem passar pelo Natan. O pedido e a resposta aparecem no chat.
- Limite (minha escolha): no meio do trabalho, só dá para chamar agentes **só-leitura** (Radar para pesquisa, Lupa para uma opinião rápida), exposto como uma ferramenta "perguntar a <agente>". Se um agente que escreve precisa de outro que escreve, ele devolve ao Bússola, que replaneja (respeitando 6.2). Essas chamadas não geram nota própria; a resposta do chamado conta só se for usada.

### 5.5 Testes e correção
- Ao fim da execução, o app roda testes/lint do projeto (detectar scripts como `npm test`, `npm run lint`, `tsc`; se não houver, pular e registrar).
- Falhou → o erro vai para o agente responsável pelo trecho, que tenta corrigir; **até 2 tentativas**. Ainda falhando → segue para revisão sinalizado como falho.

### 5.6 Revisão
- Lupa revisa o diff do pedido. Cada problema que ele aponta é atribuído a quem escreveu o trecho.
- Problemas apontados → (minha escolha) o responsável corrige uma vez e os testes rodam de novo; o que sobrar fica listado no card final.

### 5.7 Diff e decisão
- Card final: arquivos alterados (+/−), **Manter tudo / Ver diff / Desfazer**, e desfazer por arquivo. "Ver diff" mostra linha a linha.
- Não há etapa de "aplicar": os arquivos já estão alterados na pasta; a decisão é manter ou desfazer.
- **Desfazer = aplicar ao contrário só as mudanças dos agentes** (o diff entre o ponto de restauração e o estado no fim do pedido), nunca restaurar o ponto às cegas — assim edições que o Natan fez no editor durante o pedido são preservadas. Se o reverso conflitar com alguma edição dele, o app mostra o conflito em vez de sobrescrever (minha escolha).
- Desfazer fica disponível para qualquer pedido do histórico, não só o último; pedidos antigos podem dar conflito e são tratados igual (minha escolha).

### 5.7.1 Conversa contínua (minha escolha)
- Mensagens seguintes na mesma conversa carregam contexto: a triagem recebe um resumo da conversa, e o agente que já trabalhou nela **retoma a própria sessão** quando a ferramenta suportar (ex.: resume do Claude Agent SDK, thread do Codex); senão, recebe o resumo. Nova conversa = contexto limpo (só memória do projeto e cadernos).

### 5.7.2 Pergunta ao Natan (minha escolha)
- Além do card de aprovação, um agente pode **parar e fazer uma pergunta em texto livre** ao Natan (card de pergunta no chat, mascote em "Esperando você"). Onde a ferramenta não permitir pausar, o agente é instruído a assumir o mais sensato e registrar a suposição no resumo final.

### 5.8 Notas (seção 8)
- Notas por agente aparecem no fim; o mascote reage (comemora com nota alta, cabisbaixo com nota baixa).

## 6. Arquivos, pasta e segurança

### 6.1 Projeto e pasta (decidido)
- Seletor de projeto no topo: aponta para uma pasta existente ou cria uma nova. **Os agentes mexem direto nela** (sem cópia/worktree).
- O app lembra projetos recentes, cada um com seu histórico de conversas.

### 6.2 Paralelo sem conflito (minha escolha, aceita)
- Agentes só-leitura (Radar, Lupa) podem rodar em paralelo à vontade.
- Agentes que escrevem (Forja, Pincel, Curinga) só rodam em paralelo se o Bússola atribuir áreas de arquivo disjuntas (ex.: `server/` vs `web/`); na dúvida, sequência.
- Um pedido por vez por projeto (minha escolha); pedidos novos entram em fila.

### 6.3 Ponto de restauração (aceito)
- Antes de cada pedido, o app grava um ponto de restauração com git (incluindo mudanças não commitadas do Natan e arquivos novos), sem criar commit na branch dele e sem mexer no working tree. O diff final e o desfazer usam esse ponto. Técnica: escolha do construtor (ex.: snapshot da árvore com `git stash create`/objeto de árvore guardado numa ref própria tipo `refs/time/checkpoints/<id>`).
- Pasta sem git → o app pergunta se pode rodar `git init`. Se Natan recusar, o pedido roda sem desfazer (aviso claro) — minha escolha.

### 6.4 Aprovação de comandos (aceito)
- **Liberado:** ler arquivos, editar/criar arquivos dentro da pasta do projeto, comandos de leitura (`ls`, `cat`, `git status/diff/log`), rodar testes/lint/build.
- **Pede aprovação na tela** (card com o comando e Permitir/Negar, mascote "esperando"): instalar pacotes, apagar arquivos, `git push`/`commit`/`reset`/`checkout` de branch, comandos de rede, qualquer coisa fora da pasta do projeto.
- Futuro: lista configurável de "sempre permitir".

## 7. Integração com as ferramentas

Cada ferramenta entra por um **adaptador** com interface comum (iniciar tarefa com prompt + pasta + modelo; stream de eventos: texto, comando proposto, arquivo editado, pedido de aprovação, fim, erro; cancelar). O resto do app não sabe qual ferramenta está por trás.

| Ferramenta | Caminho sugerido | Observação |
|---|---|---|
| Claude Code | Claude Agent SDK (TypeScript), usando o login do Claude Code | Tem callback de permissão por ferramenta → aprovação nativa. |
| Codex | Codex SDK (TypeScript) / `codex exec` com saída JSON | Usa o login do Codex CLI. |
| Gemini CLI | modo não interativo com saída estruturada | Usa o login do Gemini CLI. |
| opencode | `opencode run` / servidor do opencode | Usa a config/login do opencode. |

**Ponto a verificar primeiro (risco principal):** para cada ferramenta, confirmar (a) que roda pela assinatura sem chave de API, (b) se dá para interceptar comandos para a regra de aprovação da 6.4. Onde não der para interceptar, o adaptador roda a ferramenta em modo restrito (só leitura ou com a política de permissão da própria ferramenta configurada para perguntar/negar) — e o papel daquele agente se ajusta (Radar e Lupa já são basicamente leitura). O construtor deve fazer esse spike antes de construir o resto.

**Configuração dos CLIs do Natan (decidido):** os agentes carregam **só as instruções** dele — CLAUDE.md (global e do projeto), AGENTS.md e equivalentes do Gemini/opencode. **Não** carregam plugins, skills, hooks nem servidores MCP da configuração pessoal, para que as execuções sejam previsíveis e não gastem limite à toa. Cada adaptador inicia a ferramenta com essas fontes desligadas (ex.: no Claude Agent SDK, controlar `settingSources`/plugins/MCP explicitamente).

**Escolha de modelo:** o Bússola escolhe por tarefa dentro da lista de modelos disponíveis de cada ferramenta (ex.: tarefa simples → modelo menor). A lista por ferramenta fica numa configuração editável.

## 8. Memória, notas e aprendizado

### 8.1 Memória de projeto
- Arquivo por projeto (sugestão: `.time/memoria.md` na pasta do projeto): stack, convenções, decisões, erros a não repetir.
- Todos os agentes leem antes de trabalhar; o Bússola atualiza no fim de cada pedido; editável pelo app.
- Versionar ou não no git do projeto: escolha do construtor (sugestão: fora do git via `.git/info/exclude`, para não poluir o repositório do Natan).

### 8.2 Nota por pedido (pedido do Natan)
- No fim de cada pedido, cada agente que trabalhou recebe nota **0–10 com o porquê em uma linha concreta** (ex.: "Forja: 7/10 — rota /health sem timeout no banco; Lupa pegou").
- Sinais (pesos são escolha do construtor, como ponto de partida):
  - testes/lint passaram de primeira → sem desconto; precisou de correção → desconto por tentativa; quebrou algo que funcionava antes → desconto maior;
  - cada problema do Lupa atribuído ao agente → desconto (maior se grave);
  - arquivos que o Natan desfez → desconto.
  - Lupa também é avaliado: se aprovou algo que depois o Natan desfez/corrigiu apontando bug, perde nota.
- O Bússola calcula e redige o porquê.
- **Quando a nota fecha (minha escolha):** aparece como **provisória** no fim do pedido (o mascote já reage) e **fecha** quando o Natan decide no card de diff ou quando começa o próximo pedido no projeto. As lições só são escritas no caderno quando a nota fecha. Desfazer um pedido antigo depois disso reabre e recalcula a nota daquele pedido.
- "Quebrou algo que funcionava antes" exige saber o estado dos testes antes do pedido; como obter isso (rodar antes, cache da última execução, ou não distinguir na v1) é escolha do construtor.

### 8.3 Correção da nota pelo Natan (decidido)
- Natan pode corrigir a nota de qualquer agente, com motivo em uma linha.
- A nota dele **substitui** a do Bússola na média.
- A correção vira lição em **dois** cadernos: no do agente avaliado e no do Bússola (para ele aprender a avaliar como o Natan).

### 8.4 Caderno de lições
- Um caderno por agente, com lições **do projeto** e **gerais** (globais, valem para todos os projetos).
- Nota baixa → vira lição acionável ("sempre colocar timeout em chamadas ao banco"). O agente lê o caderno antes de cada trabalho.
- O Bússola **consolida** periodicamente: une repetidas, remove obsoletas, mantém curto. Gatilho e tamanho máximo: escolha do construtor.
- Média de nota por tipo de tarefa entra na triagem (agente que vai mal em CSS deixa de ser escalado para CSS).

## 9. Interface

Referência visual: o mockup. Em alto nível:
- **Trilho esquerdo:** Time (palco), Agentes, Atividade, Projetos; indicador de CLIs conectados.
- **Palco (centro):** título, status ("2 de 6 trabalhando"), seletor de projeto; os 6 mascotes 3D lado a lado com nome, ferramenta e pílula de estado; balões de fala; campo de pedido flutuante com abas por agente.
- **Painel direito:** conversa atual (pedido, rodada de propostas com barras, mensagens dos agentes com horário, cards de trabalho recolhíveis, cards de aprovação, plano para aprovar, card de diff, notas). Botões de nova conversa / histórico / expandir.
- **Tela Agentes:** por agente: ferramenta, modelos permitidos, evolução da nota ao longo do tempo, caderno de lições (ler/editar).
- **Tela Atividade:** histórico de pedidos (todos os projetos) com status, duração, agentes, notas.
- **Tela Projetos:** projetos recentes, memória do projeto (ler/editar).
- Tema escuro (como o mockup); tema claro é opcional.

### 9.1 Mascotes (decidido: 3D animados desde a v1)
- Feitos em código com Three.js via React Three Fiber, um componente por mascote; sem modelos externos. O mockup mostra a técnica (caixas arredondadas, forma extrudada da estrela com gradiente por vértice, nuvem de esferas, rosto de terminal desenhado em canvas como textura).
- Estados e animações: **Disponível** (respira, pisca), **Pensando** (balança, olha para cima, `...`), **Trabalhando** (pulinhos, olhos `> <` / cursor rápido), **Esperando aprovação** (novo — escolha do construtor, algo que chame atenção), **Concluído** (pulo de alegria, `^ ^`), **Nota baixa** (cabisbaixo).
- Polimento esperado acima do mockup: transições suaves entre expressões, luz de ambiente/reflexo, acabamento comparável ao vídeo de referência.

## 10. Persistência (minha escolha)
- Dados do app (projetos, conversas, eventos, notas, configuração) num SQLite local na pasta de dados do app.
- Memória de projeto e lições do projeto como arquivos Markdown na pasta do projeto (`.time/`); lições gerais na pasta de dados do app. Markdown para Natan poder ler/editar fora do app.

## 11. Decidido pelo Natan × minhas escolhas

**Natan decidiu:** app desktop (não web); Electron em vez de Tauri; mascotes 3D animados desde o início, na linha "mascote = ferramenta" do mockup v2; elenco fixo de 6 com escalação dinâmica (criar agentes fica para depois); agentes mexem direto na pasta escolhida; rodada de propostas no modelo "equilíbrio"; plano aprovado só em pedido grande; notas por pedido com o porquê, alimentando auto-aprendizado; Natan pode corrigir a nota do Bússola; agentes carregam só as instruções dele (CLAUDE.md/AGENTS.md), sem plugins/skills/hooks/MCP; fora da v1: voz, deploy, criar agentes, distribuir.

**Minhas escolhas (Natan pode trocar):** nomes e funções dos agentes e ferramenta de cada um; paralelo só com áreas de arquivo disjuntas; um pedido por vez por projeto; ponto de restauração via git; níveis de aprovação de comando; até 2 tentativas de correção após testes; Lupa → responsável corrige uma vez; toggle para forçar plano; SQLite + Markdown; correção da nota substitui a original; nome provisório "Time"; desfazer = reverso só das mudanças dos agentes, disponível no histórico; conversa contínua com retomada de sessão; agente pode fazer pergunta em texto livre; chamadas no meio do trabalho só para agentes só-leitura; nota provisória que fecha na decisão do diff.

## 12. Deixado para o construtor
- Estrutura do repositório, bibliotecas (além de Electron, React, Three.js/R3F), empacotamento local.
- Detalhes de cada adaptador e o spike da seção 7.
- Limiar exato de "pedido grande", pesos da nota, gatilho/tamanho da consolidação do caderno.
- Técnica exata do ponto de restauração.
- Forma do prompt de triagem/confirmação e do formato estruturado das respostas.
- Visual da tela Agentes/Atividade/Projetos (seguindo o estilo do mockup).
