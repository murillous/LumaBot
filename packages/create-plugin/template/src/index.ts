import { bold, definePlugin, fmt, type PluginDefinition } from '@zapforge/core';

/** `!ola` → cumprimenta quem chamou pelo nome, com uma reação onde a plataforma tem. */
export const __export__: PluginDefinition = definePlugin({
  name: '__name__',
  version: '0.1.0',
  engine: '<1.0.0',
  // `commands` já exige `send.text`. Em `requires` vai só o que o plugin não funciona sem.
  commands: {
    ola: {
      description: 'Cumprimenta quem chamou',
      run: async (c, { capabilities }) => {
        // Reação é extra: onde o transport não tem, o plugin segue só com o texto.
        if (capabilities.has('reactions')) await c.react('👋');
        // `fmt` e `bold` viram o negrito de cada plataforma (`*a*`, `**a**`, `<b>a</b>`).
        return fmt`Olá, ${bold(c.message.sender.name ?? 'pessoa')}!`;
      },
    },
  },
});
