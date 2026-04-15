import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorageAdapter } from '../../../../src/adapters/storage/InMemoryStorageAdapter.js';
import { StoragePort } from '../../../../src/core/ports/StoragePort.js';

describe('InMemoryStorageAdapter — contrato', () => {
  it('é instância de StoragePort', () => {
    expect(new InMemoryStorageAdapter()).toBeInstanceOf(StoragePort);
  });
});

describe('InMemoryStorageAdapter — histórico de conversa', () => {
  let adapter;

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
  });

  it('retorna array vazio para JID sem histórico', async () => {
    const history = await adapter.getConversationHistory('jid@s.whatsapp.net');
    expect(history).toEqual([]);
  });

  it('salva e recupera mensagens', async () => {
    const jid = '123@s.whatsapp.net';
    await adapter.saveMessage(jid, 'user',  [{ text: 'oi' }]);
    await adapter.saveMessage(jid, 'model', [{ text: 'olá!' }]);

    const history = await adapter.getConversationHistory(jid);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ role: 'user',  parts: [{ text: 'oi' }] });
    expect(history[1]).toMatchObject({ role: 'model', parts: [{ text: 'olá!' }] });
  });

  it('mantém históricos isolados por JID', async () => {
    await adapter.saveMessage('jid1', 'user', [{ text: 'msg1' }]);
    await adapter.saveMessage('jid2', 'user', [{ text: 'msg2' }]);

    const h1 = await adapter.getConversationHistory('jid1');
    const h2 = await adapter.getConversationHistory('jid2');

    expect(h1).toHaveLength(1);
    expect(h2).toHaveLength(1);
    expect(h1[0].parts[0].text).toBe('msg1');
    expect(h2[0].parts[0].text).toBe('msg2');
  });

  it('clearHistory remove apenas o JID especificado', async () => {
    await adapter.saveMessage('jid1', 'user', [{ text: 'a' }]);
    await adapter.saveMessage('jid2', 'user', [{ text: 'b' }]);

    await adapter.clearHistory('jid1');

    expect(await adapter.getConversationHistory('jid1')).toEqual([]);
    expect(await adapter.getConversationHistory('jid2')).toHaveLength(1);
  });

  it('clearHistory em JID sem histórico não lança erro', async () => {
    await expect(adapter.clearHistory('inexistente')).resolves.not.toThrow();
  });

  it('adiciona timestamp nas mensagens salvas', async () => {
    await adapter.saveMessage('jid', 'user', [{ text: 'teste' }]);
    const history = await adapter.getConversationHistory('jid');
    expect(history[0].timestamp).toBeTypeOf('number');
  });
});

describe('InMemoryStorageAdapter — personalidades', () => {
  let adapter;

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
  });

  it('retorna null para JID sem personalidade definida', async () => {
    expect(await adapter.getPersonality('jid')).toBeNull();
  });

  it('salva e recupera personalidade', async () => {
    await adapter.setPersonality('jid', 'tsundere');
    expect(await adapter.getPersonality('jid')).toBe('tsundere');
  });

  it('atualiza personalidade existente', async () => {
    await adapter.setPersonality('jid', 'default');
    await adapter.setPersonality('jid', 'fofa');
    expect(await adapter.getPersonality('jid')).toBe('fofa');
  });

  it('personalidades são isoladas por JID', async () => {
    await adapter.setPersonality('jid1', 'tsundere');
    await adapter.setPersonality('jid2', 'fofa');

    expect(await adapter.getPersonality('jid1')).toBe('tsundere');
    expect(await adapter.getPersonality('jid2')).toBe('fofa');
  });
});

describe('InMemoryStorageAdapter — métricas', () => {
  let adapter;

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
  });

  it('getMetrics retorna objeto vazio sem métricas', async () => {
    expect(await adapter.getMetrics()).toEqual({});
  });

  it('incrementMetric começa em 1 na primeira chamada', async () => {
    await adapter.incrementMetric('stickers_created');
    const metrics = await adapter.getMetrics();
    expect(metrics.stickers_created).toBe(1);
  });

  it('incrementMetric acumula chamadas múltiplas', async () => {
    await adapter.incrementMetric('ai_responses');
    await adapter.incrementMetric('ai_responses');
    await adapter.incrementMetric('ai_responses');

    const metrics = await adapter.getMetrics();
    expect(metrics.ai_responses).toBe(3);
  });

  it('métricas diferentes são independentes', async () => {
    await adapter.incrementMetric('stickers_created');
    await adapter.incrementMetric('ai_responses');
    await adapter.incrementMetric('ai_responses');

    const metrics = await adapter.getMetrics();
    expect(metrics.stickers_created).toBe(1);
    expect(metrics.ai_responses).toBe(2);
  });
});

describe('InMemoryStorageAdapter — utilitários', () => {
  it('clear() zera todo o estado interno', async () => {
    const adapter = new InMemoryStorageAdapter();
    await adapter.saveMessage('jid', 'user', [{ text: 'msg' }]);
    await adapter.setPersonality('jid', 'tsundere');
    await adapter.incrementMetric('total');

    adapter.clear();

    expect(await adapter.getConversationHistory('jid')).toEqual([]);
    expect(await adapter.getPersonality('jid')).toBeNull();
    expect(await adapter.getMetrics()).toEqual({});
  });

  it('size() retorna número de entradas no store', async () => {
    const adapter = new InMemoryStorageAdapter();
    expect(adapter.size()).toBe(0);

    await adapter.saveMessage('jid', 'user', []);
    await adapter.setPersonality('jid', 'default');

    expect(adapter.size()).toBe(2);
  });

  it('cada instância tem estado isolado', async () => {
    const a1 = new InMemoryStorageAdapter();
    const a2 = new InMemoryStorageAdapter();

    await a1.saveMessage('jid', 'user', [{ text: 'a1' }]);

    expect(await a1.getConversationHistory('jid')).toHaveLength(1);
    expect(await a2.getConversationHistory('jid')).toHaveLength(0);
  });
});
