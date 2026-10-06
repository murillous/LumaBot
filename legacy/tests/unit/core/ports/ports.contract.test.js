import { describe, it, expect } from 'vitest';
import { AIPort } from '../../../../src/core/ports/AIPort.js';
import { MessagingPort } from '../../../../src/core/ports/MessagingPort.js';
import { StoragePort } from '../../../../src/core/ports/StoragePort.js';
import { SearchPort } from '../../../../src/core/ports/SearchPort.js';
import { TranscriberPort } from '../../../../src/core/ports/TranscriberPort.js';

/**
 * Testes de contrato — garantem que as portas base lançam erro quando
 * métodos não são implementados. Isso força subclasses a implementar
 * todos os métodos antes de serem usadas.
 */

describe('AIPort — contrato base', () => {
  const port = new AIPort();

  it('generateContent lança erro se não implementado', async () => {
    await expect(port.generateContent([])).rejects.toThrow('AIPort não implementou AIPort.generateContent()');
  });

  it('getStats lança erro se não implementado', () => {
    expect(() => port.getStats()).toThrow('AIPort não implementou AIPort.getStats()');
  });

  it('mensagem de erro inclui o nome da classe', async () => {
    class MinhaIA extends AIPort {}
    const minha = new MinhaIA();
    await expect(minha.generateContent([])).rejects.toThrow('MinhaIA não implementou AIPort.generateContent()');
  });
});

describe('MessagingPort — contrato base', () => {
  const port = new MessagingPort();

  it('body lança erro se não implementado', () => {
    expect(() => port.body).toThrow('MessagingPort não implementou MessagingPort.body');
  });

  it('jid lança erro se não implementado', () => {
    expect(() => port.jid).toThrow('MessagingPort não implementou MessagingPort.jid');
  });

  it('reply lança erro se não implementado', async () => {
    await expect(port.reply('texto')).rejects.toThrow('MessagingPort não implementou MessagingPort.reply()');
  });

  it('sendText lança erro se não implementado', async () => {
    await expect(port.sendText('texto')).rejects.toThrow('MessagingPort não implementou MessagingPort.sendText()');
  });

  it('sendMessage lança erro se não implementado', async () => {
    await expect(port.sendMessage('jid', {})).rejects.toThrow('MessagingPort não implementou MessagingPort.sendMessage()');
  });

  it('react lança erro se não implementado', async () => {
    await expect(port.react('👍')).rejects.toThrow('MessagingPort não implementou MessagingPort.react()');
  });

  it('sendPresence lança erro se não implementado', async () => {
    await expect(port.sendPresence('composing')).rejects.toThrow('MessagingPort não implementou MessagingPort.sendPresence()');
  });

  it('getQuotedAdapter lança erro se não implementado', () => {
    expect(() => port.getQuotedAdapter()).toThrow('MessagingPort não implementou MessagingPort.getQuotedAdapter()');
  });

  it('mensagem de erro inclui o nome da classe derivada', async () => {
    class MeuAdapter extends MessagingPort {}
    const meu = new MeuAdapter();
    await expect(meu.reply('texto')).rejects.toThrow('MeuAdapter não implementou MessagingPort.reply()');
  });
});

describe('StoragePort — contrato base', () => {
  const port = new StoragePort();

  it('getConversationHistory lança erro se não implementado', async () => {
    await expect(port.getConversationHistory('jid')).rejects.toThrow();
  });

  it('saveMessage lança erro se não implementado', async () => {
    await expect(port.saveMessage('jid', 'user', [])).rejects.toThrow();
  });

  it('clearHistory lança erro se não implementado', async () => {
    await expect(port.clearHistory('jid')).rejects.toThrow();
  });

  it('getPersonality lança erro se não implementado', async () => {
    await expect(port.getPersonality('jid')).rejects.toThrow();
  });

  it('setPersonality lança erro se não implementado', async () => {
    await expect(port.setPersonality('jid', 'default')).rejects.toThrow();
  });

  it('incrementMetric lança erro se não implementado', async () => {
    await expect(port.incrementMetric('stickers_created')).rejects.toThrow();
  });

  it('getMetrics lança erro se não implementado', async () => {
    await expect(port.getMetrics()).rejects.toThrow();
  });
});

describe('SearchPort — contrato base', () => {
  const port = new SearchPort();

  it('search lança erro se não implementado', async () => {
    await expect(port.search('query')).rejects.toThrow('SearchPort não implementou SearchPort.search()');
  });
});

describe('TranscriberPort — contrato base', () => {
  const port = new TranscriberPort();

  it('transcribe lança erro se não implementado', async () => {
    await expect(port.transcribe(Buffer.from(''), 'audio/ogg')).rejects.toThrow(
      'TranscriberPort não implementou TranscriberPort.transcribe()'
    );
  });
});
