// Açúcar do manifesto (ADR 0079): `commands` e `on` viram as chamadas que o `setup` faria à mão.
// Não há segundo caminho de execução: o comando passa pelo mesmo `ctx.commands.add`, com prazo,
// recusa e teardown iguais aos da forma longa.

import type { BotEventName, Listener } from '#events/types.ts';
import type { Capability } from '#transport/capabilities.ts';
import type { PluginContext, PluginDefinition, PluginListener } from './types.ts';

/** Registra os `commands` e o `on` do manifesto. Chamado pelo host antes do `setup`. */
export function installDeclared(definition: PluginDefinition, ctx: PluginContext): void {
  for (const [name, declared] of Object.entries(definition.commands ?? {})) {
    const { run, ...rest } = declared;
    ctx.commands.add({ ...rest, name, run: (c) => run.call(declared, c, ctx) });
  }
  for (const [event, listener] of Object.entries(definition.on ?? {}) as [
    BotEventName,
    PluginListener<BotEventName>,
  ][]) {
    const subscribed: Listener<BotEventName> = (e) => listener(e, ctx);
    ctx.events.on(event, subscribed);
  }
}

/**
 * `requires` declarado mais o que o manifesto implica: comando declarado pode responder texto
 * devolvendo-o, então exige `send.text` sem o autor precisar repeti-lo.
 */
export function requiredCapabilities(definition: PluginDefinition): readonly Capability[] {
  const declared = definition.requires ?? [];
  const hasCommands = Object.keys(definition.commands ?? {}).length > 0;
  return hasCommands && !declared.includes('send.text') ? [...declared, 'send.text'] : declared;
}
