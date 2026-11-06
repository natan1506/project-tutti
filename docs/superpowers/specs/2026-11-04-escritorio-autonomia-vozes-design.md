# Escritório 3D, autonomia e vozes — design

**Data:** 2026-11-04
**Status:** rascunho para o Natan revisar

## 1. Intenção e porquê

O Natan viu o post novo do Estúdio (Fernando Nogueira), o app que inspirou o Tutti, e escolheu três coisas para trazer:

1. **Escritório 3D** como uma segunda forma de ver o time, onde o lugar e o gesto de cada mascote contam o que ele está fazendo. Exemplos: o time vai para a mesa de reunião quando o Time recebe um pedido, o monitor mostra o trabalho e o telefone toca quando precisa do Natan.
2. **Autonomia em três níveis** que ele troca a qualquer momento, mais um **"parar tudo"** que interrompe o trabalho inteiro sem perder o que já foi feito.
3. **Uma voz para cada agente**, para ouvir o que importa sem olhar a tela.

O que guia tudo, nas palavras do próprio post: confiança em IA vem de **ver** o que o agente faz. O escritório e as vozes são duas formas a mais de ver e ouvir o mesmo estado que o painel já mostra. Eles não trazem informação nova, trazem formas novas de perceber.

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**
- Alternar entre **Palco** (o de hoje) e **Escritório** sem perder nada: o mesmo estado, os mesmos cliques, o mesmo painel lateral.
- Trocar o nível de autonomia em um clique, com efeito já no próximo pedido de permissão, inclusive no meio de um pedido.
- Um botão que **para tudo**: todos os pedidos de todos os projetos, inclusive os da fila, mantendo as edições e o ponto de restauração.
- Três fontes de voz, à escolha por agente: **macOS** (gratuita e local), **VoiceStudio** (gratuita, local, app de terceiros) e **ElevenLabs** (nuvem, com chave; o plano gratuito tem 10 mil créditos por mês).

**Não-objetivos (decididos pelo Natan)**
- Versão para iPhone.
- O escritório **não substitui** o palco. É uma opção de visualização.

**Não-objetivos (minha escolha)**
- Copiloto de tela, trio de mídia, editor de mascote (cor, corpo e olhos por agente) e as telas de Atividade, Dados e Contas: ficam para fases próprias.
- Clonagem de voz e criação de voz por descrição. Só se escolhe entre vozes que já existem em cada fonte.
- Falar comandos para o Tutti (reconhecimento de voz).

**Anti-objetivos (o que tornaria isto um fracasso mesmo funcionando)**
- O escritório virar uma cópia do cenário do Estúdio. Tem que ter a identidade do Tutti: o azul-marinho e o violeta→ciano do logo, e os mascotes atuais.
- O nível "sozinho" deixar passar algo destrutivo, ou qualquer escrita fora do projeto.
- Voz falando o tempo todo: ler código, cada passo ou textos longos.
- Gastar créditos pagos sem o Natan perceber, ou mandar texto para a nuvem sem ele saber.
- O "parar tudo" perder trabalho ou deixar processo de agente rodando.

## 3. Restrições

- **Nada de API cobrada por uso no caminho padrão.** A voz padrão é a do macOS. A ElevenLabs só entra se o Natan salvar uma chave e escolher uma voz dela para algum agente. O app mostra os créditos que restam.
- **Chaves** seguem a regra de hoje: Keychain (`KeyStore`), nunca em arquivo, log, banco em texto claro ou ambiente das CLIs. Só o processo principal chama a ElevenLabs.
- **Sem baixar modelos 3D ou texturas de fora.** O escritório é feito com primitivas do three.js, como os mascotes.
- **Desempenho:** o escritório roda bem num Mac Intel (a máquina do Natan). Isso quer dizer geometria simples, sem sombras dinâmicas caras, e renderização sob demanda quando nada se mexe, se der.
- Interface em português do Brasil.

## 4. Autonomia em três níveis

### 4.1 Os níveis

| Nível | Nome na interface | Ler | Editar dentro do projeto | Comandos dentro do projeto | Destrutivo / fora do projeto |
|---|---|---|---|---|---|
| 1 | **Perguntar tudo** | livre | pede | pede | pede |
| 2 | **Aceitar edições** (padrão) | livre | livre | regra de hoje (§6.4 do design original) | pede |
| 3 | **Sozinho** | livre | livre | livre | **pede** |

- O nível 2 é exatamente o comportamento de hoje. Mudar para ele não muda nada.
- "Ler" inclui `Read`, `Glob`, `Grep` e afins **dentro do projeto**. Leitura fora do projeto continua pedindo em todos os níveis, como hoje.
- **Destrutivo** pede aprovação **em todos os níveis**:
  - apagar arquivos ou pastas (`rm`, `rmdir`, `git rm`, `git clean`, `find … -delete`);
  - reescrever ou descartar histórico (`git reset --hard`, `git checkout -- .`/`git restore` de muitos arquivos, `git push --force`, `git rebase`, `git branch -D`);
  - **qualquer** `git push`;
  - mudar permissões (`chmod`, `chown`);
  - comandos com `sudo`;
  - instalar ou desinstalar pacotes globais (`npm i -g`, `brew`, `pip install` fora de venv);
  - `curl`/`wget` que encadeiam para shell (`| sh`, `| bash`);
  - qualquer escrita fora da pasta do projeto ou em `.git/`.
- A lista exata vive num só lugar (`policy/`), com testes por item.

### 4.1.1 Como o "Sozinho" garante que nada escreve fora do projeto (decidido pelo Natan)

Uma lista de comandos proibidos não garante isso: `npm run x`, `node script.js` ou `make` podem fazer qualquer coisa. Então:

- **Agentes Claude:** no Sozinho, os comandos rodam no **sandbox do macOS do próprio Agent SDK** (`sandbox: { enabled: true }`):
  - o sistema só deixa escrever na pasta do projeto;
  - `.git/hooks` e `.git/config` ficam bloqueados (`denyWrite`), pelo mesmo motivo da regra de hoje sobre `.git/`;
  - os comandos rodam sem perguntar, inclusive os que o analisador não entende (`$VAR`, `$(…)`, `&`), porque o sandbox é a barreira;
  - **continuam perguntando**: os destrutivos da lista acima (o texto do comando é conferido antes; apagar dentro do projeto também pergunta, mesmo com ponto de restauração) e qualquer `git push`;
  - se o sandbox não estiver disponível (o SDK avisa), o Sozinho desses agentes cai para "Aceitar edições" e a interface mostra: "Sozinho indisponível: usando Aceitar edições".
- **Curinga e outros agentes opencode (sem sandbox):** no Sozinho, rodam **qualquer comando**, inclusive os que o Tutti não reconhece (decidido pelo Natan em 2026-11-04, depois da parte 1). Continuam pedindo os destrutivos e os que citam caminho fora do projeto. Sem sandbox, um script do projeto (`npm run x`, `make`) ainda pode escrever fora: é o custo aceito dessa escolha.
- **Ferramentas que o Tutti não reconhece** (ex.: `Skill`, `BashOutput`) rodam no Sozinho; nos outros níveis pedem.
- Nos níveis 1 e 2 nada muda: sem sandbox, com o analisador de hoje.

### 4.1.2 Internet (decidido pelo Natan)

- **Sozinho:** livre. Pesquisar na web, abrir páginas (`WebSearch`, `WebFetch`, `webfetch` do opencode), `git fetch`/`pull` e instalar pacotes do projeto rodam sem perguntar. A rede do sandbox fica aberta.
- **Perguntar tudo e Aceitar edições:** como hoje, pedem aprovação.
- **Sempre pedem, em todos os níveis:** `git push` e `curl`/`wget` encadeados para shell (`| sh`, `| bash`).

### 4.2 Onde vale

- **Por projeto** (minha escolha): cada projeto lembra o seu nível, como já lembra o perfil. Projeto novo começa em "Aceitar edições".
- Vale para **todas as ferramentas que escrevem e respondem a permissão**: Claude (via `canUseTool`) e opencode (via `permission.asked`). Codex e Antigravity já rodam só leitura, e o nível não muda isso.
- **Consultas** (Radar, Lupa, criar e testar skill) continuam só leitura em qualquer nível.
- A decisão é tomada **a cada pedido de permissão**, lendo o nível atual. Trocar o nível no meio de um pedido vale já para a próxima ação.

### 4.3 Interface

- Um seletor de três posições no rodapé do composer, ao lado das opções do Time: `Perguntar tudo · Aceitar edições · Sozinho`.
- "Sozinho" tem uma marca visual clara (cor de alerta suave), para nunca ficar esquecido.
- O cartão de aprovação passa a dizer **por que** pediu: "fora do projeto", "destrutivo" ou "você pediu para perguntar tudo".

## 5. Parar tudo

- Um botão **Parar tudo** (■) fixo no cabeçalho do app. Só aparece habilitado quando há algum pedido rodando ou na fila, em qualquer projeto.
- Atalho: **⌘ + .** (minha escolha; é o "parar" tradicional do macOS).
- Ao clicar, **sem confirmação**, porque parar não destrói nada:
  - cancela todos os pedidos rodando, de todos os projetos (diretos, do Time e os filhos do Time);
  - tira todos os pedidos da fila;
  - fecha os cartões pendentes como recusados: aprovação negada, pergunta sem resposta, plano recusado. O aviso de limite fecha como **Continuar**, isto é, sem passar o trabalho a ninguém, porque o pedido já está parando;
  - para também o que não é pedido do Natan mas roda agente: as chamadas do coordenador (triagem, escalação, plano), as consultas ao Radar e à Lupa e as execuções de criar, testar ou ajustar skill. Todas recebem o mesmo cancelamento. As do Time e as consultas já seguem o sinal do pedido-pai; as de skill passam a ser registradas para isso;
  - interrompe qualquer voz falando.
- **O que já foi feito fica**: cada pedido cancelado mostra o diff do que mudou até ali, e Desfazer continua funcionando. É o comportamento de hoje do Cancelar, aplicado a todos.
- Os processos dos agentes precisam terminar de verdade. Teste de aceitação: depois de Parar tudo, nenhum processo de `claude`, `codex`, `agy` ou sessão do opencode iniciado pelo app continua trabalhando. O servidor do opencode pode continuar no ar, mas sem sessão ativa.

## 6. Vozes

### 6.1 Fontes

| Fonte | Como funciona | Custo | Onde vai o texto |
|---|---|---|---|
| **macOS** (padrão) | `say -v <voz>` gerando WAV, tocado pela interface | grátis | fica no Mac |
| **VoiceStudio** | app [voicestudio.sh](https://voicestudio.sh), API local em `http://localhost:3900`, compatível com OpenAI: `POST /v1/audio/speech` (`input`, `voice`, `model`, `response_format`, `language: "pt"`) e `GET /v1/audio/voices` | grátis | fica no Mac |
| **ElevenLabs** | API com chave: lista de vozes, texto→fala com modelo multilíngue | plano grátis com 10 mil créditos por mês (1 crédito por caractere); planos pagos são do Natan | vai para a ElevenLabs |

- **macOS:** a lista mostra só vozes `pt_BR` (hoje existem Luciana, Eddy, Flo, Reed, Rocko, Sandy, Shelley, Grandma e Grandpa). Uma opção "Mostrar todas" mostra as outras.
- **VoiceStudio:** o app precisa estar aberto. O Tutti confere `GET /health` e, se não responder, mostra "Abra o VoiceStudio para usar estas vozes" e cai para a voz do macOS do agente (veja §6.4).
- **ElevenLabs:**
  - A chave fica no Keychain, salva na mesma seção de Chaves de API, como um "provedor de voz".
  - A tela mostra os créditos que restam e quando renovam.
  - Ao salvar a chave e ao escolher a primeira voz da ElevenLabs, aparece um aviso: "o texto falado vai para a ElevenLabs".

### 6.2 O que é falado (minha escolha)

Só momentos que pedem atenção, sempre curtos:

| Momento | Quem fala | O que diz |
|---|---|---|
| Pedido direto terminou | o agente | a primeira frase da resposta, até 200 caracteres, sem blocos de código |
| Precisa de aprovação | o agente | "Preciso da sua aprovação: \<resumo\>" |
| Pergunta ao Natan | o agente | "Tenho uma pergunta" e a pergunta, até 200 caracteres |
| Plano pronto | o coordenador | "O plano está pronto. Pode aprovar?" |
| Time terminou | o coordenador | a primeira frase do resultado consolidado |
| Aviso de limite | o agente | "O \<ferramenta\> está em X% do limite." |
| Erro | o agente | "Deu erro: \<primeira linha\>" |

- Nunca falar passos de ferramenta, código, diffs ou caminhos longos. Antes de falar, o texto é limpo de Markdown, código e URLs.
- **Fila de fala:** uma voz por vez. Novos alertas (aprovação, pergunta, plano) passam na frente das falas de "terminei". Mais de 3 itens esperando descartam os "terminei" mais antigos.
- **Mudo** global no cabeçalho (🔊/🔇) e volume. Ficar mudo também corta a fala atual.
- O app só fala com a janela em segundo plano? **Não** (minha escolha): fala sempre que não estiver mudo. Fica anotado como pergunta para o Natan.

### 6.3 Escolher a voz de cada agente

- Uma tela **Vozes…** no menu do 👥, ao lado de Skills…:
  - em cima, as três fontes e o estado de cada uma: macOS pronto; VoiceStudio aberto ou fechado; ElevenLabs com ou sem chave e com os créditos;
  - embaixo, uma linha por agente **de todos os perfis**, agrupada por perfil, com o mascote, um seletor "fonte · voz" e o botão **▶ Ouvir**.
- A prévia fala uma frase fixa com o nome do agente: "Oi, eu sou o \<nome\>. \<função\>." Na ElevenLabs, a prévia gasta créditos, e a tela diz quantos.
- A voz é guardada **por id de agente**, fora do perfil, como as skills. Assim funciona também no Padrão, que é só leitura. Os ids são únicos entre perfis: os do Padrão são fixos (`forja`, `lupa`…), e os de perfis criados ou duplicados são gerados como `a_<uuid>` (`profileService`), então dois perfis nunca dividem a mesma voz sem querer.
- **Padrão automático:** agente sem voz escolhida recebe uma voz do macOS `pt_BR`, distinta dentro do perfil, na ordem dos agentes.

### 6.4 Falhas

- Fonte indisponível (VoiceStudio fechado, ElevenLabs sem crédito ou com chave inválida, rede caída): a fala sai com a voz **macOS** padrão daquele agente, e aparece um aviso discreto uma vez por sessão: "A voz do Forja (ElevenLabs) falhou; usei a do macOS."
- Uma falha de voz **nunca** atrapalha o pedido.

## 7. Escritório 3D

### 7.1 Como alternar

- No cabeçalho do palco, um seletor **Palco | Escritório**. A escolha é lembrada (global, não por projeto; minha escolha).
- Os dois mostram o **mesmo estado** (`deriveStage`): pose, rótulo e balão. Clicar num mascote escolhe o agente no composer, nos dois.

### 7.2 A sala

- Sala vista de cima em diagonal (isométrica, câmera fixa que se ajusta ao número de agentes, sem orbitar; minha escolha).
- **Identidade do Tutti:**
  - piso e paredes em azul-marinho;
  - luzes e detalhes em violeta→ciano;
  - uma parede com o logo do Tutti em placa iluminada;
  - um painel na parede com o resumo do time (quantos trabalhando, quantos livres), no lugar da TV.
- **Áreas:**
  - **mesas**: uma por agente, até 8, em duas fileiras;
  - **mesa de reunião** redonda;
  - **canto do café**: máquina de café e banquinhos;
  - plantas e um quadro, simples.
- **Cada mesa** tem monitor, teclado, telefone, caneca e uma plaquinha com o nome. A mesa do coordenador fica destacada (cadeira diferente ou na ponta).

### 7.3 Comportamento (o que cada coisa significa)

| Estado (`Pose` e fase do Time) | No escritório |
|---|---|
| `idle` | sentado à mesa, monitor em descanso (logo do Tutti) |
| `thinking` | sentado, monitor com "…" pulsando |
| `working` | digitando (animação de mãos ou corpo no teclado). O monitor mostra o texto do balão ("Editando src/app.ts") |
| `waiting` (aprovação, pergunta ou limite) | o **telefone da mesa toca** (pisca e balança) e o mascote olha para a câmera. Clicar no telefone abre o cartão pendente no painel lateral |
| `done` | breve comemoração e monitor com ✓ |
| `locked` | mesa apagada, cadeira vazia e plaquinha "Indisponível: \<dica\>" |
| Time: triagem, confirmação e plano | os participantes **andam até a mesa de reunião** e sentam em volta. Quem não foi chamado fica na mesa |
| Time: ondas começam | cada um volta para a sua mesa |
| Livre há algum tempo | de vez em quando, **um** agente livre vai ao café e volta (no máximo um por vez, a cada 1–3 min; minha escolha) |

- **Andar:** caminho simples por pontos fixos (corredor entre as fileiras), com velocidade constante e virando na direção do movimento. Sem colisão física.
- **Balões:** os mesmos do palco, acima do mascote.
- **Agentes por API** usam o mascote da família, como no palco.

### 7.4 Desempenho e acessibilidade

- Mesas e móveis instanciados ou mesclados.
- Animação parada quando ninguém se mexe e a janela está em segundo plano.
- Preferência de "reduzir movimento" do macOS: sem caminhadas (teletransporta) e sem telefone balançando (só piscando).

## 8. Ordem sugerida de construção

As três partes não dependem umas das outras. Proponho três planos, nesta ordem:

1. **Autonomia + Parar tudo:** é o menor e o que muda mais o uso diário.
2. **Vozes.**
3. **Escritório 3D:** é o maior, e se beneficia das vozes já prontas, porque o telefone toca junto com a fala.

## 9. Decidido pelo Natan × minhas escolhas

**Do Natan:**
- iPhone fora.
- Escritório como opção de visualização.
- Vozes com macOS, ElevenLabs e VoiceStudio.
- Autonomia em 3 níveis + parar tudo + vozes + escritório nesta fase (aceitou a proposta).
- Seguir sem a regra de API cobrada por uso no caminho padrão.
- Sozinho com o sandbox do macOS nos agentes Claude, e a lista de comandos ampliada no opencode (§4.1.1).
- Internet livre no Sozinho, pedindo nos outros níveis (§4.1.2).

**Minhas (para o Natan conferir):**
- Nível de autonomia por projeto, com padrão "Aceitar edições".
- A lista do que é "destrutivo" (§4.1), que pede aprovação em todos os níveis, inclusive qualquer `git push`.
- Parar tudo sem confirmação, com atalho ⌘ + . Para também as chamadas do coordenador, as consultas e as execuções de skill; o aviso de limite fecha como Continuar.
- O que é falado e o limite de 200 caracteres (§6.2). Voz fala mesmo com a janela em primeiro plano.
- Voz guardada por agente, fora do perfil, com padrão automático do macOS `pt_BR`.
- Falha de voz cai para o macOS.
- Escritório: câmera fixa; escolha Palco/Escritório global; café a cada 1–3 min, um por vez.
- Fora desta fase: copiloto de tela, editor de mascote, Atividade, Dados, Contas, trio de mídia, clonagem de voz.

## 10. Deixado para o construtor

- O layout exato da sala, as cores finas e a modelagem dos móveis, dentro da identidade do Tutti.
- Como a interface toca o áudio (elemento `<audio>` ou Web Audio) e o formato do arquivo entre main e renderer.
- O modelo da ElevenLabs a usar (multilíngue com bom português) e o modelo padrão do VoiceStudio.
- Como garantir o fim dos processos no Parar tudo para cada ferramenta.

## 11. Acréscimos pedidos pelo Natan em 2026-11-04 (depois da parte 1)

- **Mascotes personalizáveis** (estilo do vídeo do Estúdio): por agente, **corpo** (os cinco corpos das ferramentas), **cor** (só nos corpos do Claude; os outros mantêm a cor da ferramenta) e **olhos** (normal, concentrado, feliz). Guardado por id de agente fora do perfil, como as vozes. Tela **Mascotes** com prévia 3D.
- **Barra lateral** com os atalhos de configuração (Perfis, Skills, Vozes, Mascotes) em ícones do Lucide; a barra tem 72 px e os botões da janela do macOS ficam dentro dela.
- **Painel do chat redimensionável** (arrastar a borda; duplo clique volta ao padrão).
- **Sozinho** roda também comandos e ferramentas que o Tutti não reconhece (§4.1.1 atualizado).
- **Tela de perfis redesenhada**: agentes em cartões resumidos, um aberto por vez, rodapé fixo com salvar/descartar.

## 12. Navegador dentro do Tutti (aprovado em 2026-11-06)

Uma aba por agente, na vista **Navegador**. Você assiste ao vivo e pode **Assumir**; o agente espera até você **Devolver**.

| Nível | Ler a página aberta | Abrir site novo | Clicar e digitar |
|---|---|---|---|
| Perguntar tudo | livre | pede | pede |
| Aceitar edições | livre | pede uma vez por site | livre nos sites aprovados |
| Sozinho | livre | livre | livre |

Em todos os níveis: o agente nunca digita em campo de senha, cartão ou código; downloads sempre pedem; só `http` e `https`.
Sessão própria (`persist:tutti-browser`), sem preload nem Node. As abas fecham ao trocar de conversa ou depois de 15 minutos paradas.

Por agora, só agentes Claude por CLI (Bússola, Forja, Pincel). Curinga, Radar e Lupa ficam para depois: o Lupa roda no Codex, que não deixa o Tutti interceptar ações, então a aprovação teria de ficar dentro do próprio navegador.
