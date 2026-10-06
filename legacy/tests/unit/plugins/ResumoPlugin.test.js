import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ResumoPlugin } = await import('../../../src/plugins/resumo/ResumoPlugin.js');
const { COMMANDS }     = await import('../../../src/config/constants.js');

function makeLumaHandler(responseText = 'Rolou um papo bem animado.') {
  return {
    isConfigured: true,
    aiService: {
      generateContent: vi.fn().mockResolvedValue({ text: responseText, functionCalls: [] }),
    },
  };
}

function makeBot({ jid = 'grupo@g.us', body = '!resumo', senderName = 'Fulano' } = {}) {
  return {
    jid,
    body,
    senderName,
    reply:        vi.fn().mockResolvedValue({}),
    sendPresence: vi.fn().mockResolvedValue({}),
  };
}

async function seedMessages(plugin, jid, count, namePrefix = 'User') {
  for (let i = 0; i < count; i++) {
    await plugin.onMessage(makeBot({ jid, body: `mensagem ${i}`, senderName: `${namePrefix}${i % 3}` }));
  }
}

describe('ResumoPlugin', () => {
  describe('commands', () => {
    it('declara o comando !resumo', () => {
      expect(ResumoPlugin.commands).toContain(COMMANDS.RESUMO);
    });
  });

  describe('onMessage — acumulação do buffer', () => {
    it('acumula mensagens por JID', async () => {
      const plugin = new ResumoPlugin({ lumaHandler: makeLumaHandler() });
      await seedMessages(plugin, 'a@g.us', 3);
      await seedMessages(plugin, 'b@g.us', 2);

      const botA = makeBot({ jid: 'a@g.us' });
      await plugin.onCommand(COMMANDS.RESUMO, botA);
      expect(plugin._lumaHandler.aiService.generateContent).toHaveBeenCalledOnce();
    });

    it('ignora mensagens sem body', async () => {
      const plugin = new ResumoPlugin({ lumaHandler: makeLumaHandler() });
      await plugin.onMessage(makeBot({ body: '' }));
      await plugin.onMessage(makeBot({ body: null }));

      const bot = makeBot();
      await plugin.onCommand(COMMANDS.RESUMO, bot);
      expect(bot.reply).toHaveBeenCalledWith(expect.stringContaining('Não tem conversa'));
    });

    it('respeita o tamanho máximo do buffer (bufferSize)', async () => {
      const plugin = new ResumoPlugin({ lumaHandler: makeLumaHandler(), bufferSize: 5 });
      await seedMessages(plugin, 'g@g.us', 10);

      // pede mais que o buffer — deve receber só 5
      const bot = makeBot({ jid: 'g@g.us', body: '!resumo 200' });
      await plugin.onCommand(COMMANDS.RESUMO, bot);

      const [[promptParts]] = plugin._lumaHandler.aiService.generateContent.mock.calls;
      const promptText = promptParts[0].parts[0].text;
      const lines = promptText.split('\n').filter(l => l.includes('mensagem'));
      expect(lines).toHaveLength(5);
    });
  });

  describe('onCommand — resumo com mensagens no buffer', () => {
    let plugin;
    beforeEach(async () => {
      plugin = new ResumoPlugin({ lumaHandler: makeLumaHandler() });
      await seedMessages(plugin, 'grupo@g.us', 60);
    });

    it('chama a IA e responde com o resumo', async () => {
      const bot = makeBot();
      await plugin.onCommand(COMMANDS.RESUMO, bot);

      expect(plugin._lumaHandler.aiService.generateContent).toHaveBeenCalledOnce();
      expect(bot.reply).toHaveBeenCalledWith(expect.stringContaining('Rolou um papo bem animado.'));
    });

    it('usa o limite padrão de 50 mensagens', async () => {
      const bot = makeBot({ body: '!resumo' });
      await plugin.onCommand(COMMANDS.RESUMO, bot);

      const [[promptParts]] = plugin._lumaHandler.aiService.generateContent.mock.calls;
      const promptText = promptParts[0].parts[0].text;
      const lines = promptText.split('\n').filter(l => l.includes('mensagem'));
      expect(lines).toHaveLength(50);
    });

    it('respeita o limite numérico informado — !resumo 10', async () => {
      const bot = makeBot({ body: '!resumo 10' });
      await plugin.onCommand(COMMANDS.RESUMO, bot);

      const [[promptParts]] = plugin._lumaHandler.aiService.generateContent.mock.calls;
      const promptText = promptParts[0].parts[0].text;
      const lines = promptText.split('\n').filter(l => l.includes('mensagem'));
      expect(lines).toHaveLength(10);
    });

    it('aplica o teto máximo de 200 mensagens', async () => {
      await seedMessages(plugin, 'grupo@g.us', 140); // agora tem 200 no buffer

      const bot = makeBot({ body: '!resumo 999' });
      await plugin.onCommand(COMMANDS.RESUMO, bot);

      const [[promptParts]] = plugin._lumaHandler.aiService.generateContent.mock.calls;
      const promptText = promptParts[0].parts[0].text;
      const lines = promptText.split('\n').filter(l => l.includes('mensagem'));
      expect(lines).toHaveLength(200);
    });

    it('inclui nome do remetente no texto enviado à IA', async () => {
      const bot = makeBot({ body: '!resumo 5' });
      await plugin.onCommand(COMMANDS.RESUMO, bot);

      const [[promptParts]] = plugin._lumaHandler.aiService.generateContent.mock.calls;
      const promptText = promptParts[0].parts[0].text;
      expect(promptText).toMatch(/User\d:/);
    });
  });

  describe('onCommand — buffer vazio', () => {
    it('avisa que não tem conversa salva', async () => {
      const plugin = new ResumoPlugin({ lumaHandler: makeLumaHandler() });
      const bot = makeBot();
      await plugin.onCommand(COMMANDS.RESUMO, bot);

      expect(plugin._lumaHandler.aiService.generateContent).not.toHaveBeenCalled();
      expect(bot.reply).toHaveBeenCalledWith(expect.stringContaining('Não tem conversa'));
    });
  });

  describe('onCommand — IA não configurada', () => {
    it('responde com erro de configuração', async () => {
      const plugin = new ResumoPlugin({ lumaHandler: { isConfigured: false } });
      const bot = makeBot();
      await plugin.onCommand(COMMANDS.RESUMO, bot);
      expect(bot.reply).toHaveBeenCalledWith(expect.stringContaining('não configurada'));
    });
  });

  describe('onCommand — erro na IA', () => {
    it('responde com mensagem de erro', async () => {
      const lumaHandler = makeLumaHandler();
      lumaHandler.aiService.generateContent.mockRejectedValue(new Error('timeout'));
      const plugin = new ResumoPlugin({ lumaHandler });
      await seedMessages(plugin, 'grupo@g.us', 5);

      const bot = makeBot();
      await plugin.onCommand(COMMANDS.RESUMO, bot);
      expect(bot.reply).toHaveBeenCalledWith(expect.stringContaining('Não consegui'));
    });
  });
});
