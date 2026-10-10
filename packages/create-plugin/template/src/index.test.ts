import { createTestBot, PROFILE_NAMES, PROFILES } from '@zapforge/testing';
import { describe, expect, it } from 'vitest';
import { __export__ } from './index.ts';

// O mesmo teste em todas as plataformas do kit: cada perfil traz as capabilities e o remetente
// da plataforma, e um plugin que só passa no WhatsApp falha aqui.
describe.each(PROFILE_NAMES)('no %s', (profile) => {
  it('!ola cumprimenta quem chamou pelo nome', async () => {
    const bot = await createTestBot({ profile, plugins: [__export__] });

    await bot.receive({ text: '!ola', sender: { name: 'Ana' } });

    expect(bot.sent).toContainText('Olá, Ana!');
    await bot.stop();
  });

  it('reage só onde a plataforma tem reação', async () => {
    const bot = await createTestBot({ profile, plugins: [__export__] });

    await bot.receive({ text: '!ola' });

    const reacts = PROFILES[profile].capabilities.includes('reactions');
    expect(bot.transport.reactions).toHaveLength(reacts ? 1 : 0);
    await bot.stop();
  });
});
