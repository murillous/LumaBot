# Fase 4 — Plugin Manager

> **Status:** ⏳ Planejada  
> **Branch:** `feat/phase-4-plugin-manager`  
> **Base:** `develop` (merge da Fase 3 primeiro)  
> **Objetivo:** Transformar cada feature em um módulo auto-contido plug-n-play, eliminando a necessidade de editar código existente para adicionar ou remover funcionalidades

---

## O problema que esta fase resolve

Hoje, adicionar um novo comando ao LumaBot significa:

1. Adicionar a constante em `COMMANDS`
2. Adicionar a detecção em `detectCommand()`
3. Adicionar o case no switch de `_executeExplicitCommand()`
4. Implementar o handler em algum lugar no `MessageHandler` ou criar um novo arquivo sem padrão

Ou seja: **4 arquivos tocados para uma feature nova**. Isso viola o Princípio Aberto/Fechado (Open/Closed Principle): o sistema deveria estar fechado para modificação e aberto para extensão.

Com o Plugin Manager, adicionar um novo comando = criar um arquivo e registrá-lo.

---

## Conceito: o que é um plugin?

Um plugin é um módulo auto-contido que declara:
- Os **comandos** que ele responde
- Os **hooks** de ciclo de vida (mensagem recebida, conexão aberta, etc.)
- Suas **dependências** (quais portas precisa)

```js
// Exemplo: src/plugins/sticker/StickerPlugin.js
export class StickerPlugin {
  // Metadados
  static id = 'sticker';
  static description = 'Converte imagens em stickers';
  static commands = [COMMANDS.STICKER, COMMANDS.STICKER_SHORT];

  constructor({ mediaService, messagingPort }) {
    this.media = mediaService;
    this.messaging = messagingPort;
  }

  // Invocado quando um dos comandos listados é detectado
  async onCommand(command, botAdapter) {
    await this.media.createSticker(botAdapter);
  }

  // Hooks opcionais (implementar apenas se necessário)
  async onMessage(botAdapter) {}   // toda mensagem que não é um comando
  async onStart() {}               // quando o bot conecta
  async onStop() {}                // quando o bot desconecta
}
```

---

## `PluginManager.js` — Registro e despacho

```js
export class PluginManager {
  #plugins = new Map();
  #commandIndex = new Map(); // comando → plugin

  /**
   * Registra um plugin no manager.
   * @param {object} PluginClass - A classe do plugin (não a instância)
   * @param {Container} container - Para resolver dependências
   */
  register(PluginClass, container) {
    const plugin = container.resolve(PluginClass.id) ??
                   new PluginClass(this.#resolveDeps(PluginClass, container));

    this.#plugins.set(PluginClass.id, plugin);

    // Indexa os comandos do plugin
    for (const command of (PluginClass.commands ?? [])) {
      this.#commandIndex.set(command, plugin);
    }

    return this;
  }

  /**
   * Despacha uma mensagem: tenta comandos, depois hooks onMessage.
   * @returns {boolean} true se algum plugin tratou a mensagem
   */
  async dispatch(detectedCommand, botAdapter) {
    if (detectedCommand) {
      const plugin = this.#commandIndex.get(detectedCommand);
      if (plugin) {
        await plugin.onCommand(detectedCommand, botAdapter);
        return true;
      }
    }

    // Nenhum comando — notifica todos os plugins via onMessage
    for (const plugin of this.#plugins.values()) {
      if (typeof plugin.onMessage === 'function') {
        await plugin.onMessage(botAdapter);
      }
    }

    return false;
  }

  async startAll() {
    for (const plugin of this.#plugins.values()) {
      if (typeof plugin.onStart === 'function') await plugin.onStart();
    }
  }

  async stopAll() {
    for (const plugin of this.#plugins.values()) {
      if (typeof plugin.onStop === 'function') await plugin.onStop();
    }
  }
}
```

---

## Plugins a migrar nesta fase

| Plugin | Comandos | Hooks | Feature atual |
|--------|----------|-------|---------------|
| `StickerPlugin` | `!sticker`, `!s` | — | `MediaProcessor.createSticker()` |
| `DownloadPlugin` | `!download`, `!dl` | — | `VideoDownloader` |
| `LumaPlugin` | — | `onMessage` | `LumaHandler` + `ChatService` |
| `GroupToolsPlugin` | `!todos`, `!mute`, `!unmute` | — | `GroupService` |
| `SpontaneousPlugin` | — | `onMessage` | `SpontaneousHandler` |
| `ClearPlugin` | `!clear`, `!lc` | — | lógica de histórico no `MessageHandler` |

---

## Estrutura de arquivos

```
src/plugins/
├── PluginManager.js
├── sticker/
│   ├── StickerPlugin.js
│   └── StickerPlugin.test.js    # co-located tests
├── download/
│   ├── DownloadPlugin.js
│   └── DownloadPlugin.test.js
├── luma/
│   ├── LumaPlugin.js
│   └── LumaPlugin.test.js
├── group-tools/
│   ├── GroupToolsPlugin.js
│   └── GroupToolsPlugin.test.js
├── spontaneous/
│   ├── SpontaneousPlugin.js
│   └── SpontaneousPlugin.test.js
└── clear/
    ├── ClearPlugin.js
    └── ClearPlugin.test.js
```

---

## Como criar um novo plugin (guia futuro)

1. Crie uma pasta em `src/plugins/seu-plugin/`
2. Crie `SeuPlugin.js` com `static id`, `static commands`, `constructor({ ...deps })`, `onCommand()` ou `onMessage()`
3. Registre no `Bootstrap.js`:
   ```js
   pluginManager.register(SeuPlugin, container);
   ```
4. Pronto. Nenhum outro arquivo tocado.

---

## `MessageHandler` com Plugin Manager

Após esta fase, o `MessageHandler` delega tudo ao `PluginManager`:

```js
export class MessageHandler {
  constructor({ pluginManager, commandRouter }) {
    this.plugins = pluginManager;
    this.router = commandRouter;
  }

  async process(botAdapter) {
    const command = this.router.detect(botAdapter.lowerBody);
    await this.plugins.dispatch(command, botAdapter);
  }
}
```

~20 linhas. Toda a lógica está nos plugins.

---

## Testes a criar nesta fase

| Arquivo | O que testa |
|---------|-------------|
| `tests/unit/plugins/PluginManager.test.js` | `register`, `dispatch` (com e sem comando), `startAll`, `stopAll` |
| `tests/unit/plugins/StickerPlugin.test.js` | Chama `mediaService.createSticker()` ao receber comando |
| `tests/unit/plugins/LumaPlugin.test.js` | `onMessage` verifica trigger, chama `chatService.respond()` |
| `tests/unit/plugins/SpontaneousPlugin.test.js` | Probabilidade, guard de grupo |
| `tests/integration/PluginSystem.test.js` | PluginManager + plugins reais + adapters in-memory |

---

## Critérios de saída

- [ ] `PluginManager` implementado com register/dispatch/startAll/stopAll
- [ ] 6 plugins migrados (sticker, download, luma, group-tools, spontaneous, clear)
- [ ] `MessageHandler` com < 30 linhas delegando ao `PluginManager`
- [ ] Adicionar novo plugin = apenas 1 arquivo novo + 1 linha no Bootstrap
- [ ] Todos os testes das fases anteriores ainda passando
- [ ] Testes unitários de todos os plugins

---

*Anterior: [Fase 3 — Decomposição dos Handlers](./10-fase-3-decomposicao.md) | Próxima: [Fase 5 — Multi-Provider de IA](./12-fase-5-multi-ia.md)*
