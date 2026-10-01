# 🀄 Ultimate Mahjong Online

[![CI](https://github.com/krgitti/ultimate-mahjong/actions/workflows/ci.yml/badge.svg)](https://github.com/krgitti/ultimate-mahjong/actions/workflows/ci.yml)

Dois jogos completos em uma aplicação web: **Mahjong Solitaire** (pares de peças livres) e
**Mahjong tradicional de 4 jogadores** na variante **Hong Kong**, contra bots com estratégia real.
Motor de regras independente da interface, 100% testado, sem serviços pagos, progresso salvo no navegador.

---

## Como executar

```bash
npm install          # dependências (React 18, Vite 6, TypeScript, Vitest, Playwright, ws, tsx)
npm run dev          # desenvolvimento em http://localhost:5173
npm run server       # servidor multiplayer autoritativo em :8787
                     # com persistência: UMO_DATABASE_URL=postgres://... npm run server
npm run build        # typecheck + build de produção em dist/
npm run preview      # serve o build de produção
npm test             # 133 testes unitários/de motor/app/servidor (Vitest)
npm run typecheck:server
npx playwright test  # 7 testes e2e na interface real, incl. multiplayer com 2 browsers
                     # (instale antes: npx playwright install --with-deps chromium)
```

Requisitos: Node.js ≥ 18 (testado com Node 20).

---

## O que está implementado

### Modo 1 — Mahjong Solitaire
- **23 layouts**: os 5 clássicos pedidos — **Turtle, Dragon, Pyramid, Fortress, Butterfly** —
  mais um catálogo de 18 layouts adicionais (KMahjongg, GPL) e layouts personalizados do editor.
- **Regra de liberdade**: livre = sem cobertura na camada de cima **e** pelo menos um lado horizontal aberto
  (vizinhança em meia-peça suportada — a capa da Tartaruga usa offset de meia peça).
- **Compatibilidade configurável**: clássica (flor↔flor, estação↔estação) ou estrita (faces idênticas).
- Desfazer/refazer (histórico de 200 estados), reiniciar com as mesmas peças, **embaralhamento** do resto.
- **Dicas** com heurística (prioriza peças que liberam outras), pontuação com bônus de sequência,
  cronômetro opcional, detecção de **vitória** e de **ausência de movimentos**.
- **Salvamento automático** e restauração da partida (localStorage versionado).
- **Campanha** (10 níveis com restrições crescentes e estrelas) e **6 desafios determinísticos**
  (semente fixa = mesmo tabuleiro para todos).
- **Editor de layouts** com validação (contagem par, limites, duplicatas), **modo meia peça**
  (grade de meia-unidade, como as sobreposições da Tartaruga), **importação/exportação em JSON**
  (colar ou baixar arquivo) e jogo imediato no layout criado.

#### Gerador e solucionador
- **Construção reversa**: o gerador sorteia pares de posições *livres* e atribui faces do saco de
  72 pares; a ordem inversa da atribuição é uma solução válida **por construção**.
- Todo tabuleiro gerado é **verificado pelo solucionador exato** antes de ser aceito (nunca declaramos
  solucionabilidade sem validação); falhou → nova tentativa (máx. 24).
- **Solucionador**: DFS sobre o conjunto de peças restantes com **tabela de estados visitados**,
  ordenação por camada e limites documentados (300 mil nós / 5 s). Limites atingidos → status
  `unknown` (jamais "insolucionável" sem esgotar a busca). `unsolvable` só sai com prova exaustiva.
- Layouts com contagem ≠ 144 usam o saco de 34 faces básicas em ciclos (sempre pareável).

### Modo 2 — Mahjong Tradicional (variantes plugáveis: Hong Kong + Riichi)
A interface `Ruleset` (`src/game-engine/rules/ruleset.ts`) isola as regras do motor:
o motor nunca olha dentro de uma variante concreta. Duas implementações completas:

- **Hong Kong** (`hongkong.ts` + `hongkong-scoring.ts`) — regras **documentadas em código**:
- Vitória: **4 conjuntos + 1 par** apenas (as formas alternativas pertencem ao módulo Riichi).
- **Flores e estações em jogo**: expostas na compra/distribuição e repostas do muro morto;
  +1 fan cada, conjunto completo +2; **fan de bônus não conta para o mínimo** (regra clássica de HK).
- **Mínimo de 3 fan** (configurável; modo "chicken hand" = 1 fan). Limite de 13 fan.
- **Pagamento**: pontos = base × 2^fan. Tsumo: todos pagam. Ron: descartador paga em dobro (configurável).
- Chamadas com **prioridade Ron > Pon/Kong > Chow**; Chow só do jogador imediatamente anterior.
- Kong fechado, Kong de descarte, **Kong adicionado com janela de roubo** (rob the kong).
- Compras de reposição do **muro morto** (14 peças); **empate** por esgotamento do muro.
- **Ventos de lugar e dominante**, rotação de dealer com **renchan** (dealer repete ao vencer),
  partidas de 4/8/16 mãos, histórico completo de eventos, reinício de partida.
- Fan implementados: tsumo, mão fechada, simples, trincas de dragão/ventos (lugar+dominante somam),
  mão de trincas, meio flush, flush completo, todas as honras, vitória pós-kong, roubo do kong,
  última peça, bônus. (Tabela em `hongkong-scoring.ts`.)

- **Riichi** (`riichi.ts`, v1 documentada) — muro de 136 peças (sem flores), formas de vitória
  **standard + sete pares (chiitoitsu) + treze órfãos (kokushi)**, yaku (riichi, tsumo menzen,
  pinfu simplificado, tanyao, yakuhai, chiitoitsu, toi-toi, honitsu, chinitsu, kokushi),
  exigência de yaku (0 han = sem vitória), fu fixo 30/25, tabela mangan→yakuman, pagamentos
  clássicos (ron 4B/6B; tsumo com dealer em dobro) e **declaração de riichi** com trava de
  descarte (tsumogiri) — para humano (botão) e bots hard. Ippatsu/dora/fu completo ficam fora
  do escopo v1 (limitação documentada no arquivo). **MCR** é o próximo módulo previsto pela
  mesma interface.

#### Bots (IA)
- **Nunca acessam informação oculta**: recebem um `BotView` tipado só com mão própria + informações
  públicas (descartes por oponente, conjuntos expostos, flag de riichi, contagens). Kongs fechados
  de oponentes ficam ocultos.
- **Fácil**: descartes quase aleatórios com viés leve por honras isoladas; chama Pon/Kong ~50%, Chow ~25%.
- **Médio**: minimiza **shanten** (algoritmo recursivo com poda), desempate por **aceitação (ukeire)**;
  só chama o que melhora a mão ou vence. Sem defesa.
- **Difícil**: médio + **defesa real por contagem de esperas** (`ai/defense.ts`): genbutsu, kabe e
  suji por oponente, multiplicador de ameaça (riichi > 2 chamadas > 1 > cedo); sob ameaça alta o
  bot larga até 1 shanten para descartar a peça segura (fold), além de declarar riichi quando
  fechado e em tenpai.
- Limitações documentadas (sem betaori EV completo, sem nakasuji).
- A dificuldade **muda a estratégia de verdade** (testes automatizados comprovam decisões diferentes).

### Tutoriais interativos (não são texto!)
- **Solitaire** (6 passos): liberdade, cobertura, lados bloqueados, pares (com flores/estações),
  camadas, planejamento. Cada passo **bloqueia movimentos proibidos** com explicação.
- **Tradicional** (7 passos): naipes, compra/descarte, **Chow vs Ron**, descarte pós-chamada,
  turno dos oponentes, **Tsumo**, leitura da pontuação em fan. Mesa **100% roteirizada**
  (muro e mãos fixos; bots em tsumogiri) — determinístico e testado e2e.

### UX / acessibilidade
- Mesa verde-escura, peças de marfim com 3D suave, detalhes dourados, animações rápidas (≤ 260 ms).
- Responsivo (desktop/tablet/celular — testado a 375 px sem overflow).
- **Alto contraste**, **escala de interface** (80–130 %), som sintetizado (WebAudio, sem assets) com toggle.
- **Navegação por teclado**: peças são botões focáveis, setas navegam no tabuleiro, atalhos
  `U/R/H/S/N`, `Esc` limpa seleção.
- Tratamento de erros: saves corrompidos são descartados, falhas de storage não derrubam o jogo,
  toasts explicam movimentos ilegais.

### Persistência
- 100 % **localStorage** (adaptador injetável — testes usam memória). Chaves versionadas `umo.*.v1`:
  configurações, estatísticas, save do Solitaire, campanha, desafios, layouts personalizados.
- Nenhum dado sai do dispositivo. **Sem segredos** em código/logs/frontend (não há backend).

---

## Arquitetura

```
src/
  app/                 # shell, roteador por hash, menu inicial
  components/          # TileFace (SVG), Modal/Toasts, som
  features/
    home/              # tela inicial
    solitaire/         # tela do jogo + BoardView + Editor de layouts
    traditional/       # mesa de 4 jogadores
    tutorial/          # 2 tutoriais interativos (scripts + runners)
    challenges/        # campanha + desafios determinísticos
    profile/           # estatísticas + configurações
  game-engine/         # ★ independente de UI, determinístico, testável
    tiles/             # faces, conjunto de 144, regras de combinação, PRNG (mulberry32)
    layouts/           # tipos, 5 clássicos artesanais, catálogo KMahjongg, registro de customizados
    rules/             # HKRules (config documentada)
    scoring/           # fan + pagamentos de Hong Kong
    solitaire/         # motor (liberdade/pares/undo/redo/score/serialização) + gerador reverso
    solver/            # DFS com transposição + limites; greedy aleatório
    traditional/       # máquina de estados completa (turnos, chamadas, kong, roubo, ventos)
    ai/                # bots (BotView público, 3 dificuldades)
  storage/             # adaptadores + store versionado + perfil (stats/campanha/desafios)
  styles/              # tema premium (CSS puro, variáveis, alto contraste)
  tests/               # 96 testes (motor, app jsdom, storage)
tests/e2e/             # 6 fluxos Playwright (interface real)
```

Aleatoriedade isolada em PRNG semeado (`tiles/rng.ts`); o estado serializável do modo tradicional
guarda o estado do PRNG — partidas são reproduzíveis a partir da semente.

---

## Testes — o que foi executado

| Suíte | Comando | Resultado |
|---|---|---|
| Motor Solitaire + layouts + gerador/solucionador | `npx vitest run src/tests/solitaire.test.ts` | **47/47 ✅** |
| Motor tradicional + pontuação + bots + esperas informativas | `npx vitest run src/tests/traditional.test.ts` | **39/39 ✅** |
| Rulesets plugáveis: formas alt., Riichi (dora/ura/ippatsu/fu), MCR, betaori/pressur/nakasuji, replay, shanten tricotado + bot MCR irregular | `npx vitest run src/tests/rulesets.test.ts` | **35/35 ✅** |
| MCR tabela oficial completa (81 fan): bandas, exclusões, mãos irregulares, flores, cache/multi-decomposição, house rules | `npx vitest run src/tests/mcr-full.test.ts` | **30/30 ✅** |
| UI de revisão de replay (linha do tempo, jsdom) | `npx vitest run src/tests/replay-ui.test.tsx` | **3/3 ✅** |
| Migrações SQL versionadas (banco novo + banco legado) | `npx vitest run src/tests/migrate.test.ts` | **2/2 ✅** (Postgres real) |
| App (jsdom): init, navegação, persistência, jogo real via cliques, erros | `npx vitest run src/tests/app.test.tsx` | **13/13 ✅** |
| Editor import/export JSON | `npx vitest run src/tests/editor-io.test.ts` | **4/4 ✅** |
| Servidor autoritativo: WS real, vazamento zero, reconexão, espectadores, Postgres/contas, fila, ranked/stats, **partida ranqueada completa → Elo zero-sum + leaderboard + histórico**, chat/emotes, salas privadas, ranqueada 3+1, timer de descarte | `npx vitest run src/tests/server.test.ts` | **15/15 ✅** (Postgres real) |
| CI GitHub Actions (unit+typecheck+build com Postgres de serviço · e2e Playwright) | automático em cada push/PR | **verde ✅** |
| Typecheck app + servidor | `npx tsc --noEmit` / `npm run typecheck:server` | **0 erros** |
| Build de produção | `npm run build` | **ok** (92 KB gzip) |
| e2e Playwright (Chromium), incl. multiplayer com 2 browsers | `npx playwright test` | **7/7 ✅** |

Cobertura dos pedidos de teste: peças livres/cobertas/lados bloqueados, pares compatíveis e
incompatíveis (incl. flores), remoção, vitória, sem movimentos, solucionabilidade verificada,
undo/redo · quantidade e integridade das 144 peças, turnos, compras, descartes, chow/pung/kong,
mãos vencedoras, pontuação, empates, encerramento · inicialização, navegação, persistência,
responsividade, tratamento de erros.

---

## Multiplayer online — servidor autoritativo IMPLEMENTADO

Inclui (pedido 8): **temporadas ranqueadas mensais** (🎖️ reset de Elo com
badge da temporada anterior), **watchdog de conexão** (em ranqueadas, ausente
vira bot após o timeout), **replay das ranqueadas** (🎬 Rever no histórico),
**convite por link** (`?sala=CODE` + copiar código/convite com 1 clique) e
**i18n EN/ES** das telas.

Inclui (pedido 7): **salas privadas com senha** (🔒), **ranqueadas com 3
humanos + 1 bot**, **histórico de partidas + gráfico de Elo** por conta,
**chat/emotes**, **timer de descarte com auto-discard** e notificação de
vez (título da aba + som).

Inclui (pedido 5): **fila de matchmaking** (⚡ partida rápida — 4 jogadores, regras
não se misturam), **salas ranqueadas** por conta (🏆 resultado grava
partidas/vitórias/pontos) e **revisão de replay** com linha do tempo.

`server/main.ts` (Node + `ws`, `npm run server`, porta 8787) é um servidor **autoritativo real**:

- O estado do motor vive **somente no servidor**; cada cliente recebe `publicView(seat)` —
  mãos ocultas nunca atravessam a rede (verificado por teste).
- Salas com código de 4 caracteres; cada assento ganha um **token de reconexão** (sem contas por
  design): cair a conexão não perde o assento — reconectar com o token restaura o lugar e o
  snapshot atual (testado). Assento ausente é jogado passivamente (1º descarte legal / passar)
  para a mão nunca travar.
- O servidor controla turnos: compra automática, validação de cada ação (descarte ilegal é
  recusado), chamadas com prioridade, janelas de decisão humanas com timeout.
- Assentos vazios podem ser preenchidos por **bots do motor** ao começar (recurso de jogo, não
  simulação de humanos): dá para jogar online sozinho contra bots ou misturar amigos + bots.
- Cliente: tela **Jogar online** (`#/online`) com lobby, mesa e reconexão automática pela aba
  (token em `sessionStorage`).

**Limites de infraestrutura (documentados):** o processo vive enquanto o host viver — o sandbox da
Arena não é hospedagem permanente. Para produção: hospedar o mesmo processo (Fly.io/Railway ~US$ 5),
adicionar snapshots em Postgres + migrações e auth de contas se desejar; o protocolo e a separação
`publicView` já são os de um servidor autoritativo de verdade.

## Publicação — opções e custos

Custo de desenvolvimento: zero (só dependências open-source: React/Vite/Vitest/Playwright, layouts KMahjongg GPL).

| Opção | O que é | Custo | Observações |
|---|---|---|---|
| **Local** | `npm run dev` | grátis | usado nesta entrega (prévia ao vivo do sandbox) |
| **GitHub Pages** | estático | grátis | `vite build` + publicar `dist/` |
| **Cloudflare Pages / Netlify / Vercel** | estático + CDN | grátis (hobby) | build command `npm run build`, output `dist/` |
| **Fly.io / Railway** (se quiser servidor p/ multiplayer) | container Node | ~US$ 0–5/mês no mínimo | necessário para o roteiro multiplayer acima |

Nenhum deploy foi executado: o sandbox da Arena **não é hospedagem permanente** e publicar exige
conta/credenciais do usuário (nada automático nem financeiro). Instruções para qualquer opção acima:
`npm run build` e servir a pasta `dist/` (ou conectar o repositório ao provedor).

## Limitações conhecidas
- Servidor multiplayer vive enquanto o processo viver (memória); produção exige hospedagem
  permanente + snapshots em banco (roteiro acima). Sem contas/auth por design (v1).
- Riichi v1: sem dora/ippatsu/fu detalhado/pinfu completo; MCR ainda não implementado
  (a interface `Ruleset` é o ponto de plugagem).
- HK continua sem sete pares/órfãos (escolha de variante, documentada).
- Bots: sem betaori EV completo nem roubo de kong; kong fechado de bots desativado.
- Layouts arbitrários muito irregulares podem esgotar as 24 tentativas do gerador
  (mensagem de erro clara é exibida).
- O preview do sandbox usa fontes do sistema do visitante para os glifos CJK (SVG de texto).

## O que ficou pronto na rodada anterior (pedido 4)
1. **MCR plugável** (`src/game-engine/rules/mcr.ts`): regras de competição 1998 como terceiro
   `Ruleset` — pontuação por fan, mínimo 8 (flores fora do mínimo), tabela v1 (88 Treze Órfãos /
   3 Grandes Dragões · 64 · 24 Sete Pares/Cor Pura · 16 · 8 · 6 · 4 · 2 · 1), pagamentos oficiais
   (tsumo fan+8 de todos; ron fan+8 do descartador e 8 dos demais), seletor na tela de configurações.
2. **Dora/ippatsu/fu no Riichi**: indicador virado no morto (a peça não sai do muro), +1 indicador
   por kan, ura revelada só para vencedores em riichi; ippatsu quebrado por qualquer chamada;
   contagem completa de fu (`src/game-engine/scoring/fu.ts`): base 20, menzen-ron +10, tsumo +2,
   pares de valor, trincas/kans, esperas kanchan/penchan/tanki (classificadas pela mão pré-vitória),
   pinfu 20/30, chiitoi 25, kokushi 30, arredondamento ×10. O indicador aparece na mesa.
3. **Betaori/pressur no bot hard** (modelo de pressão documentado): *betaori* — com riichi na mesa e
   mão ≥2 shanten, o shanten é ignorado e tudo é ranked por segurança (genbutsu > visíveis >
   terminais); *pressur* — tenpai/1-shanten sem riichi: ataque total; *balanceado* — sob ameaça,
   pool best+1 com peso forte de segurança (tenpai vs riichi ataca só por peças seguras).
4. **Postgres + contas opcionais** (`server/store.ts`): salas persistidas como *seed + log de
   ações* (compacto e determinístico graças ao replay); o servidor reconstrói as salas no boot —
   restart não derruba salas; reconexão **entre dispositivos** pelo token do assento ou por conta
   opcional (tokens com hash sha256, sem segredo no banco). `UMO_DATABASE_URL` ativa; sem ele,
   memória (fallback documentado). Testado contra Postgres 17 real.
5. **Espectadores + replay determinístico**: `spectate` entra como assento −1 (snapshot público,
   zero mãos ocultas, ações bloqueadas — testado); botão **👁 Assistir** na tela online.
   `replayMatch(ruleset, {seed, actions})` reproduz uma mão **bit-idêntica** (teste compara
   mãos/poços/pontos/muro); o rng mulberry32 já era serializável.

## O que ficou pronto nesta rodada (pedido 8)
0. **Mobile legível (obs do pedido)**: no celular (≤700px) as peças da mão
   sobem para 46×62 px com scroll horizontal, mini-tiles (descartes/melds)
   maiores, e o Solitaire ganhou o botão **🔍 Ampliar** (piso de escala 0.8
   com tabuleiro rolável por toque — o fit puro deixava as figuras ilegíveis).
1. **Temporadas ranqueadas**: temporada = mês calendário (`YYYY-MM`, UTC).
   Na virada, o Elo anterior é arquivado (`prev_season`/`prev_elo`, migração
   `005`) e o rating volta a 1500; stats mostram 🎖️ Temporada atual e o
   resultado da anterior; classificação exibe a temporada corrente; cada
   linha do histórico guarda a temporada da partida.
2. **Watchdog de conexão**: em salas **ranqueadas** iniciadas, humano
   desconectado por mais de `afkTimeoutMs` (padrão 90s) vira bot
   (`Bot (era Nome)`) e a partida segue; o resultado continua valendo para a
   conta vinculada. Salas casuais mantêm o comportamento antigo (assento
   ausente e reconectável + auto-jogo passivo). Quem foi substituído não
   retoma o assento (rejoin em partida iniciada já era bloqueado), mas pode
   assistir como espectador.
3. **Replay online**: no fim da partida ranqueada o servidor serializa o log
   determinístico (seed + ações) em `match_history.replay` (migração `006`).
   O histórico sinaliza `hasReplay`; `{t:'replay', accountToken, playedAt}`
   devolve o log e a UI abre o **mesmo ReplayReview** do offline com o
   ruleset reconstruído pelo id gravado.
4. **Convite por link**: `?sala=CODE#online` preenche o código (e entra
   sozinho se a aba já tem nome salvo); na sala, botões **📋 Copiar código**
   e **🔗 Copiar convite** (Clipboard API com fallback textarea/execCommand e
   prompt de cópia manual).
5. **i18n EN/ES**: `src/i18n/` com `t(key, vars)` e fallback PT; idioma nas
   Configurações (persistido). Traduzidos: navegação, Home, Config,
   Estatísticas, botões do Solitaire/Tradicional e o chrome do Multiplayer.
   **Permanecem em PT (documentado):** tutoriais e desafios, descrições
   longas das house rules MCR e as mensagens de erro do servidor.

## O que ficou pronto na rodada anterior (pedido 7)
1. **Histórico de partidas ranqueadas**: tabela `match_history`
   (migração `004`) — uma linha por conta por partida (data, V/D,
   pontos, Elo antes→depois, sala). `{t:'history'}` devolve as últimas
   N (máx. 50); painel 📜 na UI com lista detalhada e **gráfico de Elo
   em SVG puro** (sem dependências externas).
2. **Salas privadas + ranqueada 3+1**: senha opcional na criação
   (guardada como sha256, persiste em restart); entrada/assistir exigem
   a senha — token de assento e conta dispensam. Salas ranqueadas
   começam com **3+ humanos** (vazio vira bot); Elo é zero-sum entre as
   contas vinculadas.
3. **Notificações de vez + timer de descarte**: online, o servidor é
   dono do relógio (`turnExpiresAt` no snapshot, padrão 30s,
   `discardTimeoutMs` configurável) e **descarta sozinho** se o jogador
   estourar o prazo; a aba pisca "▶ Sua vez!" com som e a mesa mostra
   countdown com barra. Offline, o mesmo comportamento roda na tela.
4. **House rules MCR configuráveis**: mínimo de fan (1–88, padrão 8
   oficial) e bônus de posição de flores (liga/desliga) nas
   Configurações, aplicados ao motor; testados na fronteira.
5. **CI publicado + badge**: workflow de CI ativo no GitHub Actions
   (verde) e badge de status no topo do README.

## O que ficou pronto na rodada anterior (pedido 6)
1. **Rating Elo + leaderboard**: `server/elo.ts` (Elo round-robin de mesa,
   K=32, empates 0.5, zero-sum exato). No fim da partida ranqueada o
   servidor calcula os deltas entre as contas vinculadas e grava
   (`elo` na migração `003_elo.sql`). `{t:'leaderboard'}` → top 20 por
   Elo; stats incluem ⭐ Elo; UI com painel 🏅 Classificação.
   **Testado com uma partida ranqueada COMPLETA** (2 humanos + 2 bots,
   4 mãos reais, ~3,5 min) verificando Elo zero-sum e leaderboard.
2. **Chat de mesa + emotes**: `{t:'chat'}` (máx. 140) e `{t:'emote'}`
   (8 emotes fixos do servidor) para jogadores e espectadores; rate
   limit de 600ms; **não toca no estado autoritativo** (teste prova que
   nenhum snapshot é emitido). Painel 💬 no lobby e na mesa.
3. **MCR otimizado**: `decomposeAll` memorizado (LRU 4096, ~2.4× mais
   rápido medido em mão rica em decomposições) e
   `knittedStraightVariants` enumera TODAS as decomposições (o
   avaliador fica com a melhor — fan de espera incluído). Equivalência
   frio/quente verificada em 150 mãos aleatórias.
4. **Bots perseguem mãos irregulares MCR**: shanten dedicado
   (`ai/knitted.ts`) para 全不靠/七星不靠 e 組合龍; bot hard em MCR,
   com o tricotado na frente do normal, descarta para minimizá-lo e
   recusa chamadas (mão fechada); betaori mantém prioridade.
5. **CI (GitHub Actions)**: `.github/workflows/ci.yml` — jobs *unit*
   (typecheck + vitest com Postgres 17 de serviço + build) e *e2e*
   (Playwright/Chromium) em todo push/PR. *Obs.: publicar o arquivo de
   workflow exige escopo OAuth `workflow`; ver seção abaixo.*

## O que ficou pronto na rodada anterior (pedido 5)
1. **Tabela MCR completa — os 81 fan oficiais** (`src/game-engine/rules/mcr.ts` reescrito):
   todos os elementos do Green Book (WMO, seção 3.8.1 + Apêndice 1) nos 12 níveis
   (88/64/48/32/24/16/12/8/6/4/2/1), com a **tabela oficial de exclusões** ("does not
   combine with"; onde a tradução inglesa diverge da edição chinesa — que o prefácio
   declara prevalecente — seguimos a chinesa, casos documentados no código). Fan por
   instância (箭刻/暗杠/明杠/幺九刻/四归一), escolha da **melhor decomposição** entre todas
   as válidas, mãos irregulares (`全不靠`, `七星不靠`, `組合龍`, `九蓮宝燈`, sete pares em
   escada), `絶張` via peças visíveis contadas pelo engine, `無番和` (chicken hand).
   **Flores por posição**: 1 fan por peça (#81 oficial) + 1 fan extra quando o número da
   flor/estação bate com o vento do lugar (house rule `flowerPositionBonus`, padrão
   ligada); flores seguem sem contar no mínimo de 8 fan. `MCR_FAN_TABLE` exporta a
   tabela (nº, valor, EN/PT/CN) para UI e testes.
2. **Esperas informativas + nakasuji**: `waitsWithCounts()` no engine devolve as peças
   que completam a mão e **quantas cópias restam** (descontando descartes, melds abertos
   e a própria mão; usa o `canWin` do ruleset, então vale para 7 pares/órfãos/mãos
   tricotadas). Painel na mesa: com 13 peças mostra as esperas com contagem; com 14
   mostra **cada descarte que deixa tenpai** e as esperas resultantes. No bot:
   `dangerScore` reestruturado (perigo de sequência vs par) com **nakasuji** — descarte
   da peça do meio (4/5/6) desconta leituras de sequência (kanchan/ryanmen) sem afetar
   shanpon.
3. **Replay com UI de revisão** (`ReplayReview.tsx`): o gravador determinístico
   (seed + log de ações) já existia; agora há a revisão — linha do tempo com slider,
   ⏮ ◀ ▶ ⏭, **salto mão a mão**, lista de ações clicável, mini-tabuleiro por assento
   (descartes/melds/pontos) e log de eventos. Botões "🎬 Rever partida" (fim) e
   "Rever até aqui" (fim de mão).
4. **Matchmaking rápido + salas ranqueadas**: fila no servidor (`{t:'queue'}` por
   regras — regras diferentes não se misturam; posição/tamanho em tempo real;
   `{t:'unqueue'}`); com **4 na fila o servidor monta a mesa, senta, vincula contas e
   começa**. **Salas ranqueadas** (`{t:'create', ranked:true}`, exige conta): no fim da
   partida o servidor grava `played/wins/points` nas contas vinculadas;
   `{t:'stats'}` devolve as estatísticas. UI: "⚡ Partida rápida", "🏆 Sala ranqueada",
   "📊 Estatísticas" e selo 🏆 na mesa.
5. **Empacotamento para hospedagem permanente**: **migrações SQL versionadas**
   (`server/migrations/NNN_*.sql` + `server/migrate.ts`): ordem lexicográfica, uma
   transação por arquivo, controle em `schema_migrations`, idempotente (testado em
   banco novo **e** em banco legado pré-migrações, dados preservados). O
   `PostgresStore.init` roda as migrações no boot; CLI: `npm run migrate`.
   **Dockerfile** (node:20-alpine, deps de produção, healthcheck `/health`,
   `UMO_DATABASE_URL` opcional) + `.dockerignore`; `tsx`/`ws` movidos para
   `dependencies`. *O sandbox não tem Docker: a imagem não foi construída aqui — o
   comando de runtime (`npm run server`) e as migrações foram verificados direto.*

## CI (GitHub Actions)
`.github/workflows/ci.yml` roda em todo push/PR: job **unit**
(typecheck app+servidor, `vitest run` com **Postgres 17 de serviço** —
os testes de servidor/migrações rodam de verdade — e `npm run build`) e
job **e2e** (Playwright/Chromium). Localmente equivale a:
`npx tsc --noEmit && npm run typecheck:server && npx vitest run && npm run build && npx playwright test`.
*Nota: editar o arquivo de workflow via push exige escopo OAuth
`workflow` — pela interface web do GitHub não há restrição.*

## Hospedagem permanente (servidor)
```bash
docker build -t ultimate-mahjong-server .
docker run --rm -p 8787:8787 \
  -e UMO_DATABASE_URL=postgres://user:pass@host:5432/umo \
  ultimate-mahjong-server
# migrações manuais (opcionais — o boot já roda):
docker run --rm -e UMO_DATABASE_URL=... ultimate-mahjong-server npx tsx server/migrate.ts
```
O frontend é estático: `npm run build` → `dist/` em qualquer CDN/static host
(a tela online deriva a URL do WS do hostname, incluindo o proxy de prévia).

## Próximos passos sugeridos
1. Temporadas ranqueadas (reset mensal de Elo com badge de temporada).
2. Watchdog de conexão: substituir humano ausente por bot após N segundos
   em salas ranqueadas (hoje ele é auto-jogado passivamente).
3. Replay online: salvar o log da partida ranqueada e oferecer revisão
   (a UI de replay do offline já existe — conectar ao histórico).
4. Convite por link (URL com código da sala) e cópia do código com 1 clique.
5. i18n (EN/ES) das telas — o motor já nomes de fan em 3 idiomas.
