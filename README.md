# 🀄 Ultimate Mahjong Online

Dois jogos completos em uma aplicação web: **Mahjong Solitaire** (pares de peças livres) e
**Mahjong tradicional de 4 jogadores** na variante **Hong Kong**, contra bots com estratégia real.
Motor de regras independente da interface, 100% testado, sem serviços pagos, progresso salvo no navegador.

---

## Como executar

```bash
npm install          # dependências (React 18, Vite 6, TypeScript, Vitest, Playwright, ws, tsx)
npm run dev          # desenvolvimento em http://localhost:5173
npm run server       # servidor multiplayer autoritativo em :8787
npm run build        # typecheck + build de produção em dist/
npm run preview      # serve o build de produção
npm test             # 117 testes unitários/de motor/app/servidor (Vitest)
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
| Motor tradicional + pontuação + bots | `npx vitest run src/tests/traditional.test.ts` | **36/36 ✅** |
| Rulesets plugáveis: formas alt., Riichi (fan/pagamentos/riichi) e defesa | `npx vitest run src/tests/rulesets.test.ts` | **16/16 ✅** |
| App (jsdom): init, navegação, persistência, jogo real via cliques, erros | `npx vitest run src/tests/app.test.tsx` | **13/13 ✅** |
| Editor import/export JSON | `npx vitest run src/tests/editor-io.test.ts` | **4/4 ✅** |
| Servidor autoritativo: 2 clientes WS reais, vazamento zero, reconexão | `npx vitest run src/tests/server.test.ts` | **1/1 ✅** |
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

## Próximos passos sugeridos
1. Módulo MCR plugável na interface `Ruleset`.
2. Dora/ippatsu/fu completo no Riichi.
3. Betaori/pressur modelling nos bots hard.
4. Snapshots de salas em Postgres + reconexão entre dispositivos + contas opcionais.
5. Espectadores e replay determinístico (o rng já é serializável).
