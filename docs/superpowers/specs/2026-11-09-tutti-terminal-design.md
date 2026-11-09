# Tutti no terminal — desenho

Data: 2026-11-09. Autor da conversa: Natan. Este documento descreve a versão de terminal do Tutti e a esteira de trabalho que ela usa.

## 1. Por que

No trabalho, o Natan faz desenvolvimento e QA quase todo com o Claude Code, no terminal. O limite do plano da empresa acaba; ele troca para o plano pessoal; na sexta de manhã os dois costumam estar esgotados e o trabalho fica parado até segunda. Enquanto isso, Codex, Antigravity e opencode (que ele também tem) ficam sem uso.

A ideia é usar **agentes especializados com o trabalho dividido**: o Claude pensa e revisa, os outros implementam e testam. O gasto se espalha pelas IAs em vez de estourar uma só, e o limite do Claude dura a semana.

Ele já trabalha no terminal; por isso a versão é de terminal, no mesmo jeito de uso do Claude Code.

### Sucesso
- O Natan chega na sexta com limite do Claude sobrando.
- Codex / Antigravity / opencode carregam parte real do trabalho.
- Ele vê, por tarefa, quanto cada IA gastou — e consegue conferir se a divisão economiza de verdade.

### Fracasso mesmo funcionando (antiobjetivos)
- A divisão sair **mais cara** que fazer tudo direto no Claude (o cérebro gasta muito planejando e revisando trabalho que volta várias vezes do tester).
- Virar um segundo produto com dados, agentes e configs separados do app.
- Esconder do Natan quem fez o quê ou por que um agente foi trocado.

### Fora do escopo
- **Substituir o Claude quando ele acaba.** Quando o limite do cérebro acaba, o Tutti avisa e para; o Natan segue sozinho, como hoje.
- **Trocar de conta do Claude.** O Natan troca a conta logada no Claude Code na mão. O Tutti usa a conta que estiver logada.
- Mascotes 3D, escritório, vozes e o navegador visível (ficam só no app).
- Agentes por **API paga** na primeira versão (as chaves são cifradas pelo `safeStorage` do Electron; ler isso fora do app é trabalho à parte). O caminho padrão do Tutti já é sem API cobrada por uso.

## 2. O que é

É o mesmo Tutti — mesmo time, mesmos agentes, mesmo histórico — com outra cara: uma tela de terminal que fica aberta (como o Claude Code). O Natan digita `tutti` dentro do repositório em que está trabalhando e conversa com o time ali.

**Compartilha tudo com o app:** o mesmo banco (`time.db` em `~/Library/Application Support/Tutti/`), as mesmas conversas, perfis, agentes, autonomia por projeto e registros de uso. Uma conversa começada no app aparece no terminal e vice-versa.

## 3. A esteira

O fluxo padrão vem da config do projeto:

1. **Cérebro** (padrão: Claude) entende o pedido e escreve exatamente o que precisa ser feito e o critério de pronto.
2. **Executor** (padrão: Codex) implementa.
3. **Tester** (padrão: Antigravity) valida de verdade — roda os testes e, quando fizer sentido, abre o navegador (invisível no terminal; só o resultado aparece).
4. Volta ao **cérebro**, que revisa: pronto, ou volta ao executor com o que falta.
5. **Reserva** (padrão: opencode) entra quando alguém da esteira não está disponível.

Os papéis são agentes do perfil (os mesmos do `/agents`), não ferramentas soltas.

### O cérebro escolhe quem faz — troca e avisa
O cérebro pode desviar da esteira num caso específico quando tiver motivo concreto, **sem perguntar**: troca e avisa numa linha, com o motivo. Exemplos de linha:
- `↪ passei a tela para o Pincel em vez do Forja: nas últimas 4 telas o Forja voltou do tester 3 vezes`
- `↪ Radar sem limite até segunda: o Curinga assume como tester`

Os motivos vêm de três fontes, nesta ordem de peso:
1. **Disponibilidade:** ferramenta fora do ar, sem login ou com limite esgotado.
2. **Histórico real dos projetos do Natan:** por agente e tipo de tarefa — terminou ou deu erro, quantas vezes voltou do tester, se o Natan desfez.
3. **Limite que sobra:** acima do limiar de "poupar o cérebro" (config), o cérebro passa mais trabalho para os outros.

Papéis **travados** na config nunca são trocados pelo cérebro.

### Relação com o time do app
Hoje o time do app faz triagem dinâmica (o coordenador dá nota a cada agente e escala quem entra). A esteira é um **modo novo do time**, no núcleo, configurado no perfil. Decisão minha: quando o perfil tem esteira configurada, app e terminal usam a esteira; sem esteira, o time segue como hoje. Assim o mesmo perfil se comporta igual nos dois lados.

### Quando o cérebro acaba
Limite do cérebro esgotado: o pedido em andamento termina a etapa atual e para; o Tutti avisa (`Claude sem limite até seg 09h — o time parou`) e não aceita novos pedidos de time até o Natan trocar de conta ou o limite voltar. Quando o Natan troca a conta no Claude Code, o Tutti percebe e o placar passa a mostrar a conta nova, sem reiniciar.

## 4. A tela

Tela cheia no terminal, ao estilo do Claude Code.

**Placar no topo, sempre visível, uma linha só:** nome de cada agente da esteira, barra cheia (`██████░░░░`) e percentual de uso da janela de limite que importa para aquela ferramenta.

```
Tutti · docpay-backoffice   Bússola ██████████░░░░░ 68%   Forja ████░░░░░░░░░░░ 27%   Radar ██░░░░░░░░░░░░░ 12%   Curinga ░░░░░░░░░░░░░░░  0%
```

- Cor por faixa: verde até 60%, amarelo até 85%, vermelho acima (decisão minha).
- Esgotado: no lugar do percentual, `esgotado · seg` (quando volta).
- Janela estreita: as barras encurtam (mesmo estilo) para o placar continuar numa linha; os nomes encolhem por último.

**Conversa:** cada etapa da esteira aparece ao vivo, uma linha por agente (planejou / implementou com arquivos e +/− / testando / resultado), com quanto gastou. Trocas do cérebro aparecem em amarelo com o motivo. Aprovações pedidas pela autonomia aparecem na própria conversa e são respondidas pelo teclado.

**Comandos:**
| Comando | Faz |
|---|---|
| `/agents` | Lista o time (nome, IA, modelo, papel, uso). Cria, edita e remove agentes: trocar IA/modelo, função, se pode escrever ou só ler. Mesmos agentes do app. |
| `/config` | Esteira (cérebro, executor, tester, reserva); papéis travados; autonomia (os 3 níveis do app); limiar para poupar o cérebro; perfil por projeto. |
| `/usage` | Detalhe do placar: gasto de cada IA por tarefa e quando cada limite volta. |
| `/history` | Conversas anteriores do projeto, inclusive as do app; retomar uma. |
| `/new` | Conversa nova. |
| `/undo` | Desfaz a última tarefa (só em pasta com git). |
| `/stop` | Para o time na hora. |
| `/exit` | Fecha o Tutti. |

## 5. Restrições

- **Núcleo compartilhado.** Reaproveitar o processo principal do app: só `index.ts`, `ipc.ts`, `windowOptions.ts` e `browser/electronPage.ts` importam Electron; adaptadores, runs, time, autonomia, uso, perfis e store são Node puro. O terminal é outra "casca" sobre esse núcleo, não uma cópia.
- **Um pedido por vez por projeto, valendo entre app e terminal.** Hoje a fila (`ProjectQueue`) vive na memória do app. Com os dois abertos no mesmo projeto, dois agentes poderiam escrever nos mesmos arquivos. A fila precisa valer entre processos (decisão minha; o como fica com o construtor).
- **Banco aberto por dois processos ao mesmo tempo** sem corromper nem perder escrita.
- **Pasta sem git funciona** (já é assim no app desde 2026-11-09): só fica sem diff e sem `/undo`.
- Regras que já valem no projeto continuam valendo: chaves de API nunca em arquivo, log, banco em texto puro ou env dos agentes; nada de API cobrada por uso no caminho padrão; repositório privado.
- **Mac Intel (x86_64)** é a máquina do Natan; tem que funcionar nela.

## 6. Instalação (decisão minha)

O comando `tutti` vem com o app: o app instala um atalho no PATH (como o `code` do VS Code) que roda o núcleo com o Node embutido no Electron (`ELECTRON_RUN_AS_NODE`). Assim não depende de o Natan ter outra versão de Node, e `node:sqlite` é o mesmo do app. Se isso esbarrar em algo, o construtor pode propor outro jeito, mantendo: um comando `tutti`, sem instalar Node à parte, mesma versão do núcleo do app instalado.

## 7. Decisões depois da revisão

**Executor e tester podem escrever (aprovado pelo Natan em 2026-11-09).** Hoje o Codex roda só-leitura e o Antigravity em `--mode plan`, porque o Tutti não consegue aprovar ação por ação nessas ferramentas. Na esteira, eles ganham escrita com estes limites:
- **Cerca:** escrevem só dentro da pasta do projeto, sem rede. No Codex isso é o `sandboxMode: 'workspace-write'` sem acesso à rede. No Antigravity, usar o modo equivalente que a ferramenta oferecer. Se não houver modo que limite à pasta, o construtor diz isso antes de liberar.
- **Aprovação:** nos níveis de autonomia que pedem aprovação, o Natan aprova o plano do cérebro antes de ele ir ao executor. No nível "sozinho", segue direto.
- **Rede de segurança:** o ponto de restauração do git cobre a tarefa inteira, e o `/undo` desfaz tudo de uma vez.
- **Onde vale:** fora da esteira, os dois continuam só-leitura, como hoje. Dentro da esteira, vale também no app quando o perfil tiver esteira.

**Antigravity não escreve (testado em 2026-11-09, decisão do Natan).** Dois testes com o `agy` em modo sem janela deram este resultado:
- no modo `auto`, ele recusa toda escrita;
- no modo `accept-edits`, com regra liberando só a pasta do projeto, ele escreveu dentro **e fora** da pasta, e não conseguiu rodar comandos.

A cerca não segura. Por isso o Antigravity continua só-leitura, e o **tester passa a ser um agente Codex**, com a mesma cerca do executor. Esse agente roda os testes de verdade. O Antigravity fica no perfil para pesquisa e consulta.

As decisões abaixo são minhas, para conferir:

- **Quem ocupa cada papel.** Hoje, no perfil Padrão, o Forja é Claude e o único agente Codex é o Lupa (revisor, só lê). Para não mudar o time do app, a esteira vem num **perfil novo, "Trabalho"**, com agentes próprios:
  - Bússola: Claude, cérebro.
  - Forja: Codex, executor.
  - Lupa: Codex, tester.
  - Curinga: opencode, reserva.
  - Radar: Antigravity, só-leitura, para pesquisa e consulta (fora da esteira).

  O Natan pode editar tudo pelo `/agents` e pelo `/config`.
- **Navegador do tester no terminal.** Na primeira versão, o tester usa o navegador que a própria ferramenta dele tiver (o Antigravity tem um). O navegador embutido do Tutti continua só no app, porque depende do Electron.
- **Percentual do placar.**
  - **Valor oficial:** só existe para o Claude e para o Codex. Os dois mostram o número que a própria ferramenta informa.
  - **Estimativa:** o Antigravity mostra uma estimativa marcada com `~` quando há teto configurado. Sem teto, mostra `—`.
  - **Opencode:** mostra `—`.
  - **Esgotado:** um agente vira "esgotado" quando a ferramenta devolve erro de limite. O horário de volta aparece quando a ferramenta informa.
- **Qual janela manda.** Para "poupar o cérebro", vale a janela **semanal** do Claude. Se qualquer janela esgotar, inclusive a de 5h, o cérebro conta como sem limite: o time para e diz quando volta.
- **Limite de voltas.** No máximo **2 voltas** do cérebro ao executor por tarefa (ajustável no `/config`). Estourou, o time para e devolve ao Natan um resumo do que falta. O cérebro não faz o trabalho ele mesmo.
- **App e terminal no mesmo projeto.** Quem começou o pedido responde às aprovações dele. O outro lado vê o pedido pelo histórico, depois. Não há sincronização ao vivo entre os dois na primeira versão.
- **O que conta como "desfez".** Só o `/undo` do terminal e o Desfazer do app. Reverts feitos à mão no git não entram na nota.

## 8. O que fica com o construtor

- Biblioteca da interface de terminal.
- Como a fila vale entre processos (trava no banco, arquivo de trava etc.).
- Como o histórico vira nota por agente e tipo de tarefa, e como classificar "tipo de tarefa".
- Formato exato das telas de `/agents`, `/config`, `/usage`, `/history`.
- Ordem de entrega, desde que a primeira entrega útil seja: `tutti` abre no repositório, mostra o placar e roda a esteira padrão com Claude → Codex → Antigravity → Claude.
