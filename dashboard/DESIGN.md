# Guia de design do dashboard da Luma

Quem constrói ou altera o `dashboard/` segue este documento. Ele diz **o que** cada tela faz,
**de onde** vêm os dados e **quais regras visuais** valem. O protótipo mostra **como** fica.

## Protótipo

Canvas no Claude Design: <https://claude.ai/artifact/1DpDG4M4hWZmNzi27QjorS#page-dcb81aee8d83>

- É privado. Um agente da conta do dono lê pela ferramenta `Artifact` (`action: "read"`, com
  `path`). Cada tela é um arquivo: `project/Main.dc.html` (Visão geral), `project/Ai.dc.html` (IA),
  `project/Plugins.dc.html`, `project/Logs.dc.html` e `project/Audit.dc.html`. O `renderVals()` de
  cada arquivo mostra o comportamento esperado (reordenar a cadeia, filtros, estados).
- Os números, nomes e eventos do canvas são **de exemplo**. Nada deles vai para o código.
- Canvas e guia divergem? **O guia vence.** Avise o dono para atualizar o canvas.

## Stack e lugar

- `dashboard/` na raiz, pacote próprio do workspace do pnpm: Vite, React, TypeScript strict e
  Tailwind CSS v4.
- Cliente da API gerado do `openapi.json` do core com `openapi-fetch`
  ([fazer o próprio frontend](https://github.com/murillous/usebridger/blob/develop/packages/plugin-dashboard/docs/README.md#fazer-o-próprio-frontend)).
  Nada de tipo de resposta escrito à mão.
- Mesma origem do bot: login em `POST /api/auth/login`, `fetch` com `credentials: 'same-origin'`.
  Um 401 em qualquer chamada volta para o login.
- Tempo real: **um** `EventSource` em `/api/events`, com os tipos que a tela usa.
- As convenções do repositório valem aqui também (Biome, PT-BR, só named exports).

## Princípios

1. **Configura uma vez.** O modelo de IA se escolhe só na tela IA. Plugin que usa IA mostra qual
   cadeia está valendo e um link para a tela IA; nunca tem o próprio seletor de modelo.
2. **Escolhe, não digita.** Modelo vem do catálogo (`GET /api/plugins/ai/catalog`, #416), em
   lista. Temperatura é slider na faixa do provedor. Saída de tokens é um segmentado com valores
   prontos. Campo de texto livre só para o que é texto de verdade.
3. **O fallback é visível.** A cadeia aparece numerada, na ordem de tentativa, com o estado de
   cada posição em palavra. As regras de quando passa para o próximo aparecem uma vez, em tabela.
4. **A estrutura segue o conteúdo.** Comparação vira tabela, sequência vira lista numerada,
   explicação vira texto. Card só para bloco autocontido; nunca card dentro de card.
5. **Cor só carrega estado.** A ação usa a cor da tinta (`--ink`). Verde, âmbar, vermelho e azul
   só para ok, aviso, erro e informação, sempre com a palavra junto.
6. **"Ao vivo" só quando é.** O indicador diz "ao vivo" com o `EventSource` conectado,
   "reconectando" quando cai, e some quando a pessoa não tem `connection.read`.
7. **Nenhum número sem fonte.** Indicador que a API não fornece não aparece (nada de "+12% vs.
   ontem" inventado).

### Proibido

Estes padrões foram tirados do protótipo e não voltam:

- faixa de indicadores em cards iguais;
- rótulo em maiúsculas espaçadas acima de título;
- ícone dentro de caixa colorida, logo em caixa, ícone decorativo no menu;
- etiqueta colorida em toda linha de tabela (em tabela, o estado é a palavra colorida);
- gradiente, blur, brilho, emoji como ícone;
- animação de entrada ou de rolagem; hover que move ou aumenta o elemento;
- frase de ajuda repetida em cada item de uma lista.

Antes de pôr um tratamento visual, complete a frase: "está aqui porque o produto, o conteúdo, a
interação ou a marca exige ___". Se a resposta é "fica bonito" ou serviria para qualquer produto,
tire.

## Tokens

Os mesmos do painel do Bridger
([design.md do plugin-dashboard](https://github.com/murillous/usebridger/blob/develop/packages/plugin-dashboard/docs/design.md)).
Componente nenhum usa cor direta: tudo sai das variáveis.

```css
@import "tailwindcss";

:root {
  --bg: #f4f4f1; --raised: #ffffff; --sunken: #ebebe7;
  --ink: #151514; --ink2: #2a2a28; --muted: #5c5c58;
  --line: #17171614; --line2: #17171624; --plate: #7f7f7f1a;
  --agent: #0063d1; --agent-soft: #e3eefd;
  --ok: #1f7a45; --ok-soft: #e2f2e8;
  --warn: #9a5b00; --warn-soft: #fbeed5;
  --danger: #b42a20; --danger-soft: #fbe4e1;
  --e1: 0 1px 1px #1717160a, 0 2px 4px -1px #1717160d, 0 0 0 1px var(--line);
  --e2: 0 1px 1px #1717160a, 0 6px 16px -4px #1717161a, 0 0 0 1px var(--line);
  --e3: 0 2px 4px #1717160a, 0 24px 56px -16px #1717164d, 0 0 0 1px var(--line2);
  --top: inset 0 1px 0 #ffffffe6;
}

/* Escuro: pelo sistema, salvo escolha manual de claro; ou escolha manual de escuro. */
@media (prefers-color-scheme: dark) {
  /* O CSS não compartilha bloco: repita aqui todas as variáveis do [data-theme="dark"]. */
  :root:not([data-theme="light"]) { /* … */ }
}
:root[data-theme="dark"] {
  --bg: #0f0f0e; --raised: #1c1c1b; --sunken: #0a0a09;
  --ink: #efefec; --ink2: #d6d6d2; --muted: #a3a39e;
  --line: #ffffff1a; --line2: #ffffff26;
  --agent: #5aa8ff; --agent-soft: #11253f;
  --ok: #5fc48a; --ok-soft: #13291c;
  --warn: #e0a84a; --warn-soft: #33260e;
  --danger: #f08a80; --danger-soft: #3a1714;
  --e1: 0 1px 2px #00000080, 0 0 0 1px var(--line);
  --e2: 0 8px 20px -6px #0009, 0 0 0 1px var(--line);
  --e3: 0 28px 64px -16px #000c, 0 0 0 1px var(--line2);
  --top: inset 0 1px 0 #ffffff14;
}

@theme inline {
  --color-bg: var(--bg); --color-raised: var(--raised); --color-sunken: var(--sunken);
  --color-ink: var(--ink); --color-ink2: var(--ink2); --color-muted: var(--muted);
  --color-line: var(--line); --color-line2: var(--line2); --color-plate: var(--plate);
  --color-agent: var(--agent); --color-agent-soft: var(--agent-soft);
  --color-ok: var(--ok); --color-ok-soft: var(--ok-soft);
  --color-warn: var(--warn); --color-warn-soft: var(--warn-soft);
  --color-danger: var(--danger); --color-danger-soft: var(--danger-soft);
  --shadow-e1: var(--e1); --shadow-e2: var(--e2); --shadow-e3: var(--e3);
  --font-sans: "Onest", system-ui, sans-serif;
  --font-display: "Funnel Display", "Onest", sans-serif;
  --font-mono: "Martian Mono", ui-monospace, monospace;
}
```

- **Fontes:** Onest (texto e interface), Funnel Display (títulos e números de indicador), Martian
  Mono (ids, modelos, eventos, logs, hashes). Servidas pelo próprio app via pacotes `@fontsource`,
  sem Google Fonts em runtime.
- **Escala:** 28 título da tela, 20 seção, 17 subseção, 14,5 corpo (altura de linha 1,5), 13
  ajuda, 12 rótulo e mono. Nada abaixo de 12.
- **Espaço:** 4, 8, 12, 16, 24, 32. Margem da página 32 (16 no celular), 24 entre seções.
- **Raio:** 6 pequeno, 10 campo e linha selecionada, 12 botão, 14 card, 999 chip.
- **Borda:** é o anel de 1 px dentro da sombra (`--e1`) ou a linha `--line` entre itens; não
  existe `border` + sombra + raio no mesmo elemento.

## Componentes

| Componente | Regra |
| --- | --- |
| Botão | Mínimo 40 px de altura, raio 12. Primário `--ink` com texto `--bg` (um por tela, no máximo); secundário `--plate`; destrutivo `--danger-soft` e pede confirmação; desabilitado com opacidade 0,45 |
| Estado | Palavra na cor do estado (`text-ok`, `text-warn`...). É o padrão em tabela e lista |
| Chip | Fundo `*-soft` e texto na cor do estado, sempre com palavra. Só onde o estado é o assunto do item ("Precisa de atenção") |
| Segmentado | Fundo `--sunken`; opção ativa em `--raised` com `e1`; `aria-pressed`. Até 6 opções; mais que isso vira `select` |
| Interruptor | `role="switch"` e `aria-checked`; ligado em `--ok`. Liga e desliga plugin |
| Campo | Rótulo visível acima, ajuda abaixo, erro junto do campo com `aria-invalid` e `aria-describedby`. Segredo é máscara que só se substitui |
| Tabela | Dentro de caixa com rolagem horizontal; cabeçalho em 12 `--muted`; linhas separadas por `--line`. Linha que expande é um `button` com `aria-expanded` |
| Card | `--raised`, raio 14, `e1` + `--top`. Para o formulário de um plugin, uma tabela, a lista de "Precisa de atenção" |
| Menu | Sidebar de 248 px: Bot (Visão geral, IA, Plugins), Observabilidade (Logs, Auditoria), Administração (Conexão, Usuários, Chaves de API). Item ativo em `--raised` com `e1` e `aria-current="page"`. Abaixo de 768 px vira gaveta aberta pelo botão Menu |

Foco visível em tudo: anel de 2 px `--ink` com afastamento de 2 px. Alvo de toque com no mínimo
44 px. `prefers-reduced-motion` desliga qualquer transição.

## Telas

Cada tela trata os estados carregando, vazio, erro da API (com a mensagem e "tentar de novo") e
**sem permissão**: o que a pessoa não pode fazer some, com as permissões de `GET /api/auth/me`.

### Visão geral (`/`)

O bot está bem? O que precisa de mim?

1. Conexão do WhatsApp numa linha (`GET /api/connection` e evento `connection`).
2. **Precisa de atenção**, primeiro e em card: provider sem chave e modelo em cooldown
   (`/api/plugins/ai/status`, #416), avisos e erros recentes (`GET /api/logs?level=warn`), plugin
   que falhou no boot (`GET /api/plugins`). Cada item com o link que resolve. Sem item, uma linha
   "Nada pendente".
3. **Hoje**, em linha, sem cards: mensagens, respostas da IA, custo e erros, do `plugin-metrics`
   (`/api/plugins/metrics/query`). Métrica que não existe no catálogo não aparece.
4. Cadeia de IA resumida e mudanças recentes da auditoria (`GET /api/audit?limit=5`).

### IA (`/ia`)

Monta a cadeia e diz quem usa qual. Config em `GET`/`PUT /api/plugins/ai/config`.

- **Ordem de tentativa:** lista numerada da cadeia `models`. Cada linha: modelo em mono,
  provedor e parâmetros, estado (`pronto`, `em espera, 38 s`, `pulado, sem chave`) e os botões
  subir, descer e remover (com `aria-label`). Selecionar uma linha abre a edição ao lado.
  Fecha com "Se todos falharem, a Luma avisa no chat que está indisponível".
- **Edição da posição:** provedor (segmentado), modelo (rádios do catálogo), temperatura (slider
  de 0 ao máximo do provedor, com "padrão do provedor", que tira o campo), saída máxima
  (segmentado: padrão, 512, 1.024, 2.048, 4.096, 8.192). Trocar de provedor limita a temperatura
  ao novo máximo. Modelo que está na config mas fora do catálogo aparece como "fora do catálogo",
  sem bloquear.
- **Adicionar modelo:** o catálogo por provedor; o modelo que já está na cadeia fica desabilitado.
- **Quando passa para o próximo:** tabela fixa, da seção Fallback de `docs/ai.md`. Embaixo,
  `timeoutMs`, `cooldownMs` e `maxToolSteps` em segundos e passos.
- **Por recurso:** tabela de `luma`, `resumo`, `transcribe`, `spontaneous` e `web-search`, cada um
  com "Ordem principal" ou "Própria" (o campo `models` do plugin, salvo com
  `PUT /api/plugins/<nome>/config`). "Própria" abre a mesma edição de cadeia.
- **Chaves:** uma linha por provedor do catálogo: configurada, pela variável (só leitura, com o nome
  dela) ou sem chave, com o campo de senha.
- **Salvar:** um botão para a tela toda, só ativo com alteração; "Alterações não salvas" ao lado.
  Sair com alteração pendente pede confirmação. Erro 400 aparece junto do campo (`errors[].path`).

### Plugins (`/plugins`, `/plugins/:nome`)

Liga, desliga e ajusta cada plugin.

- Lista à esquerda, agrupada (Conversa, Mídia, Utilidades, Sistema), com o interruptor
  (`POST /api/plugins/<nome>/enable|disable`). Só o estado fora do normal aparece em texto:
  "com avisos", "falhou no boot".
- Formulário à direita, **gerado do JSON Schema** do `GET /api/plugins/<nome>/config`, com estes
  controles:

  | Schema | Controle |
  | --- | --- |
  | `number`/`integer` com `minimum` e `maximum`, até 200 passos | Slider com o valor ao lado |
  | `number`/`integer` sem limite | Campo numérico com a unidade |
  | `enum` com até 4 valores | Segmentado |
  | `enum` maior | `select` |
  | `array` de `string` | Etiquetas com remover e um campo para adicionar |
  | `string` com padrão `#rrggbb` | Seletor de cor com o hex |
  | segredo | Senha com máscara |
  | campo `models` | Não é campo: "Ordem principal" ou a cadeia própria, com link para a tela IA |
  | origem `env` ou arquivo | Desabilitado, com a variável na ajuda |

  O rótulo e a ajuda vêm do `title` e da `description` do schema. Falta texto bom num campo?
  A correção é no `.describe()` do plugin, não um rótulo fixo no frontend.
- Salvar manda os overrides que já existiam mais o que mudou; campo esvaziado sai do corpo.

### Logs (`/logs`)

O que está acontecendo, com filtro.

- Histórico de `GET /api/logs` mais as linhas novas do evento `log` do `EventSource`.
  Pausar congela a lista; retomar junta o que chegou.
- Filtros: nível mínimo (segmentado com a contagem de cada nível no buffer), plugins (botões que
  combinam), busca por evento ou texto. Os filtros vão para a URL.
- Tabela: hora, nível (palavra colorida), plugin, evento (`fields.event`; sem ele, "texto livre" em
  `--muted`), mensagem. A linha expande e mostra os `fields` em JSON e "Só este evento".
- Rodapé: "N de 1.000 linhas", "Mais antigas" (cursor `before`), e o aviso de que chat e contato
  aparecem pseudonimizados.
- **Eventos por plugin:** tabela com os eventos `plugin.ação.resultado` de cada plugin no buffer e
  a contagem. Plugin sem nenhum mostra "só texto livre". Ela se preenche sozinha conforme os plugins
  migram para `log.event` (#408): o frontend não tem lista de eventos.

### Auditoria (`/auditoria`)

Quem fez o quê, quando e com que resultado.

- Linha de estado da cadeia de hash: "Cadeia íntegra" ou "Cadeia quebrada no #N" com o motivo,
  e "Verificar a cadeia de hash" (`POST /api/audit/verify`, desabilitado enquanto roda).
- Exportar CSV e JSON (`GET /api/audit/export`, com os filtros da tela).
- Filtros: quem (Painel, WhatsApp, Sistema), resultado, período; vão para a URL e para a query.
- Tabela: quando, o quê (título legível e a `action` em mono), quem (nome e papel ou origem),
  resultado (palavra colorida). A linha expande: alvo, `details`, seq e hash, "Só esta ação".
- O título legível de cada `action` sai de um mapa no frontend; ação sem título mostra a própria
  `action`. As ações da Luma (`luma.persona.set`, `luma.history.clear`, `ai.model.change`,
  `rank.reset`, `command.owner`, `transport.pairing`) entram com a #404.

## Responsivo

Funciona de 320 px a 1440 px sem rolagem horizontal da página:

- abaixo de 768 px o menu vira gaveta e os campos de texto vão a 16 px (o iOS não dá zoom);
- edição da cadeia vai para baixo da lista, e os filtros quebram em linhas;
- tabelas rolam dentro da própria caixa.

## Antes do PR

- [ ] A tela confere com o artboard dela no canvas, com os dados reais da API.
- [ ] Nenhum item da lista **Proibido**.
- [ ] Nenhuma cor fora dos tokens (`grep -E '#[0-9a-f]{3,6}' dashboard/src` só acha o arquivo
      dos tokens).
- [ ] Claro e escuro, 320 px e 1440 px, teclado de ponta a ponta, contraste de 4,5:1.
- [ ] Estados carregando, vazio, erro e sem permissão.
