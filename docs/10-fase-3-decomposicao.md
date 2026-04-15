# Fase 3 — Decomposição dos Handlers

> **Status:** ⏳ Planejada  
> **Branch:** `feat/phase-3-decompose-handlers`  
> **Base:** `develop` (merge da Fase 2 primeiro)  
> **Objetivo:** Quebrar o `MessageHandler` (659 linhas, 7+ responsabilidades) em serviços de domínio coesos com responsabilidade única

---

## O problema que esta fase resolve

O `MessageHandler.js` é uma God Class. Ele:

1. Detecta o tipo de mensagem
2. Roteia para handlers específicos
3. Executa lógica de IA (Luma)
4. Processa mídia (stickers, downloads)
5. Gerencia grupos (@everyone, admin checks)
6. Controla histórico de conversa
7. Gerencia personalidades
8. Executa buscas na internet

Uma mudança em qualquer um desses aspectos arrisca quebrar todos os outros. Não há como testar uma responsabilidade isoladamente.

---

## Diagnóstico atual

```
MessageHandler.js — 659 linhas
├── detectCommand()         → deveria ser um CommandRouter
├── process()               → orquestração de alto nível (ok)
├── _executeExplicitCommand() → deveria ser um CommandExecutor
├── _handleLumaInteraction() → deveria ser o ChatService (Fase 1/2)
├── _handleMedia()          → deveria ser o MediaService (Fase 1/2)
├── _handleGroup()          → deveria ser o GroupService
├── extractUrl()            → utilitário puro (ok como util)
└── getMessageType()        → utilitário puro (ok como util)
```

**Dependência circular identificada:**
```
MessageHandler → MediaProcessor
MediaProcessor → MessageHandler  ← ciclo!
```

Esta fase quebra esse ciclo introduzindo `MediaService` como intermediário.

---

## Estrutura alvo

```
src/
├── core/
│   └── services/
│       ├── ChatService.js     # Lógica de conversa com a IA (parcialmente criado na Fase 2)
│       ├── MediaService.js    # Transcrição, sticker, download (parcialmente na Fase 2)
│       ├── GroupService.js    # @everyone, admins, mute        ← NOVO nesta fase
│       └── CommandRouter.js   # Detecta e roteia comandos      ← NOVO nesta fase
│
└── handlers/
    └── MessageHandler.js  # Apenas orquestração — < 150 linhas após esta fase
```

---

## `CommandRouter` — Detecção e roteamento

Extrai toda a lógica de detecção de comandos para uma classe testável independentemente:

```js
export class CommandRouter {
  #commands = new Map();

  /**
   * Registra um handler para um comando.
   * @param {string} command - O comando (ex: COMMANDS.STICKER)
   * @param {Function} handler - Async function(botAdapter, container) => void
   */
  register(command, handler) {
    this.#commands.set(command, handler);
    return this;
  }

  /**
   * Detecta o comando na mensagem e executa o handler.
   * @returns {boolean} true se um comando foi executado
   */
  async dispatch(botAdapter, container) {
    const command = this.detect(botAdapter.lowerBody);
    if (!command) return false;

    const handler = this.#commands.get(command);
    if (!handler) return false;

    await handler(botAdapter, container);
    return true;
  }

  /**
   * Detecta qual comando está presente na mensagem.
   * @param {string} text
   * @returns {string|null}
   */
  detect(text) {
    const lower = text?.trim().toLowerCase() ?? '';
    // Lógica migrada de MessageHandler.detectCommand()
    // ...
    return null;
  }
}
```

---

## `GroupService` — Lógica de grupos

```js
export class GroupService {
  constructor({ messagingPort, storagePort }) {
    this.messaging = messagingPort;
    this.storage = storagePort;
  }

  /**
   * Menciona todos os participantes de um grupo.
   * @param {BotAdapter} botAdapter
   */
  async mentionAll(botAdapter) {
    // migrado de MessageHandler._handleEveryoneCommand()
  }

  /**
   * Verifica se o remetente é admin do grupo.
   */
  async isAdmin(jid, participantJid) {
    // migrado de MessageHandler._isAdmin()
  }

  /**
   * Silencia/desilencia participante.
   */
  async mute(botAdapter, targetJid, durationMs) {
    // migrado de MessageHandler._handleMute()
  }
}
```

---

## `MessageHandler` refatorado — < 150 linhas

Após a decomposição, o `MessageHandler` vira um **orquestrador fino**:

```js
export class MessageHandler {
  constructor({ commandRouter, chatService, mediaService, groupService }) {
    this.router = commandRouter;
    this.chat = chatService;
    this.media = mediaService;
    this.group = groupService;
  }

  async process(botAdapter) {
    // 1. Tenta rotear para um comando explícito
    const handled = await this.router.dispatch(botAdapter, {
      chat: this.chat,
      media: this.media,
      group: this.group,
    });

    if (handled) return;

    // 2. Verifica se a Luma foi mencionada
    if (this.chat.isTriggered(botAdapter)) {
      await this.chat.respond(botAdapter);
      return;
    }

    // 3. Processa mídia não comandada (transcrição automática de áudio, etc.)
    await this.media.processPassive(botAdapter);
  }
}
```

---

## Quebra da dependência circular

```
Antes:
  MessageHandler → MediaProcessor → MessageHandler  ← ciclo!

Depois:
  MessageHandler → MediaService → TranscriberPort  ← sem ciclo
                               → MessagingPort
```

O `MediaProcessor` existente pode continuar como implementação interna do `MediaService`, mas o `MediaService` não importa o `MessageHandler` — a comunicação acontece via portas injetadas.

---

## Plano de migração incremental

A decomposição deve ser feita **sem quebrar o sistema em produção**:

1. Criar `GroupService` e `CommandRouter` como **novas classes** ao lado do handler existente
2. Adicionar testes para as novas classes
3. Mover responsabilidades do `MessageHandler` para as novas classes **uma por vez**
4. A cada move, rodar todos os testes
5. Só remover o código do `MessageHandler` depois que os testes das novas classes cobrirem o comportamento

---

## Testes a criar nesta fase

| Arquivo | O que testa |
|---------|-------------|
| `tests/unit/core/CommandRouter.test.js` | `detect` (todos os comandos), `dispatch` (handler chamado, retorno bool) |
| `tests/unit/core/GroupService.test.js` | `mentionAll`, `isAdmin`, `mute` com messaging mock |
| `tests/unit/handlers/MessageHandler.test.js` | Orquestração: chama router, chat, media na ordem certa |
| `tests/integration/MessageFlow.test.js` | Fluxo completo: mensagem → comando → resposta |

---

## Critérios de saída

- [ ] `CommandRouter` com detecção e dispatch de todos os comandos existentes
- [ ] `GroupService` com toda lógica de grupos migrada
- [ ] `MessageHandler` com menos de 150 linhas
- [ ] `MessageHandler` usando apenas construtor com injeção (sem `new` interno)
- [ ] Zero dependências circulares (verificar com `madge` ou `dependency-cruiser`)
- [ ] Todos os testes da Fase 0 ainda passando
- [ ] Cobertura do `MessageHandler` refatorado > 80%

---

## Ferramentas para detectar dependências circulares

```bash
# Instalar madge
npm install --save-dev madge

# Detectar ciclos
npx madge --circular --extensions js src/

# Gerar grafo visual
npx madge --image graph.png src/
```

---

*Anterior: [Fase 2 — Container de DI](./09-fase-2-container-di.md) | Próxima: [Fase 4 — Plugin Manager](./11-fase-4-plugin-manager.md)*
