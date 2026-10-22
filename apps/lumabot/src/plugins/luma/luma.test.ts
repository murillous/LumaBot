import { definePlugin } from '@usebridger/core';
import { metrics } from '@usebridger/plugin-metrics';
import { createTestBot, DEFAULT_SELF, fixtures, type TestBot } from '@usebridger/testing';
import { APICallError } from 'ai';
import type { MockLanguageModelV4 } from 'ai/test';
import { afterEach, describe, expect, it } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { aiMetrics } from '#plugins/ai-metrics/ai-metrics.ts';
import { fakeProvider, promptText, scripted, textAnswer, toolAnswer } from '#plugins/ai-testing.ts';
import { rank } from '#plugins/rank/rank.ts';
import { transcribe } from '#plugins/transcribe/transcribe.ts';
import { luma } from './luma.ts';
import { PERSONAS } from './personas.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

const group = { id: 'grupo@fake', isGroup: true };
const FAST = { thinkingDelayMs: { min: 0, max: 0 } };

async function start(model: ReturnType<typeof scripted>) {
  bot = await createTestBot({
    plugins: [ai, fakeProvider({ a: model }), luma],
    pluginConfig: { ai: { models: [{ model: 'fake:a' }] }, luma: FAST },
  });
  return bot;
}

/** Só as mensagens da conversa (histórico e fala de agora), sem a instrução de sistema. */
function conversation(model: MockLanguageModelV4, call: number): string {
  const prompt = model.doGenerateCalls[call]?.prompt ?? [];
  return JSON.stringify(prompt.filter((m) => m.role !== 'system'));
}

describe('quando a Luma responde', () => {
  it('em conversa privada, citando a mensagem', async () => {
    const b = await start(scripted('oi, tudo bem?'));

    await b.receive({ text: 'e aí' });

    expect(b.sent).toHaveReplied('oi, tudo bem?');
  });

  it('em grupo, ignora o que não é com ela', async () => {
    const model = scripted('não devia');
    const b = await start(model);

    await b.receive({ text: 'bom dia, pessoal', chat: group });

    expect(b.sent).toHaveLength(0);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('em grupo, responde quando chamada pelo nome, sem o nome na pergunta', async () => {
    const model = scripted('opa');
    const b = await start(model);

    await b.receive({ text: 'Ei Luma, que horas são?', chat: group });

    expect(b.sent).toHaveReplied('opa');
    expect(promptText(model)).toContain('Usuário: que horas são?');
  });

  it('em grupo, responde a quem cita uma fala dela', async () => {
    const b = await start(scripted('claro'));

    await b.receive({
      text: 'sério?',
      chat: group,
      quoted: { text: 'eu amo pizza', fromMe: true, chat: group },
    });

    expect(b.sent).toHaveReplied('claro');
  });

  it('em grupo, responde quando mencionada', async () => {
    const b = await start(scripted('presente'));

    await b.receive({
      text: '@bot vem cá',
      chat: group,
      mentions: [{ ...DEFAULT_SELF, tag: '@bot' }],
    });

    expect(b.sent).toHaveReplied('presente');
  });

  it('não responde a outro bot', async () => {
    const model = scripted('x');
    const b = await start(model);

    await b.receive({ text: 'luma, oi', sender: { isBot: true } });

    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('divide a resposta nos balões marcados e limita a quantidade', async () => {
    const b = await start(scripted('mano[PARTE]não acredito[PARTE]sério'));

    await b.receive({ text: 'conta' });

    const texts = b.sent.flatMap(({ content }) => (content.type === 'text' ? [content.text] : []));
    expect(texts).toEqual(['mano', 'não acredito']);
  });

  it('chamada sem dizer nada leva uma resposta de tédio, sem gastar a IA', async () => {
    const model = scripted('x');
    const b = await start(model);

    await b.receive({ text: 'luma', chat: group });

    expect(model.doGenerateCalls).toHaveLength(0);
    expect(b.sent).toContainText(/Fala logo|Tô ouvindo|Digita aí/);
  });

  it('reivindica a mensagem: quem tem prioridade menor a vê reivindicada', async () => {
    const seen: boolean[] = [];
    const watcher = definePlugin({
      name: 'watcher',
      version: '0.0.0',
      engine: '<1.0.0',
      setup: (ctx) => {
        ctx.events.on('message', { priority: -10 }, (e) => void seen.push(e.claimed));
      },
    });
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ a: scripted('oi') }), luma, watcher],
      pluginConfig: { ai: { models: [{ model: 'fake:a' }] }, luma: FAST },
    });

    await bot.receive({ text: 'oi' });
    await bot.receive({ text: 'bom dia', chat: group });

    expect(seen).toEqual([true, false]);
  });
});

describe('memória', () => {
  it('lembra da conversa nos turnos seguintes', async () => {
    const model = scripted('prazer, Ana', 'seu nome é Ana');
    const b = await start(model);

    await b.receive({ text: 'meu nome é Ana', sender: { name: 'Ana' } });
    await b.receive({ text: 'qual meu nome?', sender: { name: 'Ana' } });

    const second = promptText(model, 1);
    expect(second).toContain('Ana: meu nome é Ana');
    expect(second).toContain('prazer, Ana');
    expect(second).toContain('Ana: qual meu nome?');
  });

  it('em grupo, cada pessoa tem a sua conversa', async () => {
    const model = scripted('ok');
    const b = await start(model);

    await b.receive({
      text: 'luma, segredo da Ana',
      chat: group,
      sender: { id: 'ana@x', name: 'Ana' },
    });
    await b.receive({ text: 'luma, oi', chat: group, sender: { id: 'bia@x', name: 'Bia' } });

    // O que a Ana disse chega à Bia só como clima do grupo, nunca como memória dela.
    expect(conversation(model, 1)).not.toContain('segredo da Ana');
    expect(promptText(model, 1)).toContain('CONTEXTO AMBIENTE');
  });

  it('em grupo, a conversa do grupo vira clima ambiente, sem a fala de agora', async () => {
    const model = scripted('ok');
    const b = await start(model);

    await b.receive({ text: 'alguém viu o jogo?', chat: group, sender: { name: 'Caio' } });
    await b.receive({ text: 'luma, quem ganhou?', chat: group, sender: { name: 'Ana' } });

    const prompt = promptText(model);
    expect(prompt).toContain('CONTEXTO AMBIENTE');
    expect(prompt).toContain('Caio: alguém viu o jogo?');
    expect(prompt).not.toMatch(/Ana: luma, quem ganhou[\s\S]*CONTEXTO AMBIENTE/);
    expect(prompt.match(/quem ganhou/g)).toHaveLength(1);
  });

  it('!luma clear esquece, e !lc e !clear são o mesmo comando', async () => {
    const model = scripted('ok');
    const b = await start(model);

    for (const cmd of ['!luma clear', '!lc', '!clear']) {
      await b.receive({ text: 'lembra disso: banana' });
      await b.receive({ text: cmd });
      expect(b.sent).toHaveReplied('🗑️ Memória limpa nesta conversa!');
      await b.receive({ text: 'o que eu disse?' });
      expect(promptText(model, model.doGenerateCalls.length - 1)).not.toContain('banana');
    }
  });

  it('!luma sem subcomando explica o uso', async () => {
    const b = await start(scripted('x'));

    await b.receive({ text: '!luma' });

    expect(b.sent).toContainText(/!luma clear.*!luma stats/);
  });

  it('!luma stats mostra as conversas ativas', async () => {
    const b = await start(scripted('ok'));
    await b.receive({ text: 'oi' });

    await b.receive({ text: '!ls' });

    expect(b.sent).toContainText(/Conversas ativas: 1/);
  });
});

describe('!luma stats com o aiMetrics', () => {
  it('mostra respostas, tokens e custo da IA nos últimos dias', async () => {
    bot = await createTestBot({
      plugins: [metrics, ai, fakeProvider({ a: scripted('oi') }), aiMetrics, luma],
      pluginConfig: {
        ai: { models: [{ model: 'fake:a' }] },
        'ai-metrics': {
          prices: { 'fake:a': { inputPerMillion: 1_000_000, outputPerMillion: 2_000_000 } },
        },
        luma: FAST,
      },
    });
    await bot.receive({ text: 'oi' });
    await bot.receive({ text: 'e aí' });

    await bot.receive({ text: '!luma stats' });

    expect(bot.sent).toContainText(/últimos 7 dias/);
    expect(bot.sent).toContainText(/Conversas ativas: 1/);
    expect(bot.sent).toContainText(/Respostas: 2 \(100% de sucesso\)/);
    expect(bot.sent).toContainText(/Tokens: 6 de entrada, 4 de saída/);
    expect(bot.sent).toContainText(/Custo estimado: US\$\s14,00/);
  });
});

describe('personas', () => {
  it('usa a persona padrão no prompt', async () => {
    const model = scripted('ok');
    const b = await start(model);

    await b.receive({ text: 'oi' });

    expect(promptText(model)).toContain('Você é a Luma, uma jovem brasileira inteligente');
  });

  it('!persona mostra o menu com a atual, as marcas e uma ação por persona', async () => {
    const b = await start(scripted('x'));

    await b.receive({ text: '!persona' });

    const menu = b.sent.at(-1)?.content;
    expect(menu?.type === 'text' ? menu.text : '').toContain('Atual neste chat: Luma Pensadora');
    for (const p of PERSONAS) expect(b.sent).toContainText(new RegExp(p.name));
    expect(b.sent).toContainText(/Luma Pensadora ⭐ \(Padrão\)/);
  });

  it('!persona 2 troca a persona do chat, e só dele', async () => {
    const model = scripted('ok');
    const b = await start(model);

    await b.receive({ text: '!persona 2' });
    expect(b.sent).toHaveReplied('✅ Personalidade alterada para: *Luma Pistola*');
    await b.receive({ text: 'oi' });
    await b.receive({ text: 'oi', chat: 'outro@fake' });

    expect(promptText(model, 0)).toContain('Luma Pistola');
    expect(promptText(model, 1)).not.toContain('Luma Pistola');
  });

  it('aceita p2, a chave e o nome', async () => {
    const b = await start(scripted('x'));

    for (const ref of ['p3', 'intelectual', 'luma literal']) {
      await b.receive({ text: `!persona ${ref}` });
    }

    expect(b.sent).toContainText('✅ Personalidade alterada para: *Luma Good Vibes*');
    expect(b.sent).toContainText('✅ Personalidade alterada para: *Luma Sênior*');
    expect(b.sent).toContainText('✅ Personalidade alterada para: *Luma Literal*');
  });

  it('opção inexistente responde inválida', async () => {
    const b = await start(scripted('x'));

    await b.receive({ text: '!persona 99' });

    expect(b.sent).toContainText(/Opção inválida/);
  });

  const generated = JSON.stringify({
    name: 'Vovó Italiana',
    description: '👵 carinhosa',
    context: 'Você é uma vovó italiana.',
    style: 'sotaque carregado',
    traits: ['faz massa', 'chama de bambino', 'reclama'],
  });

  it('!persona criar gera, ativa, limpa a memória e passa a usar a nova', async () => {
    const model = scripted('resposta antiga', generated, 'mamma mia');
    const b = await start(model);
    await b.receive({ text: 'oi' });

    await b.receive({ text: '!persona criar uma vovó italiana' });
    expect(b.sent).toHaveReplied('Prontinho! Agora eu sou *Vovó Italiana*! 😎');
    await b.receive({ text: 'e aí' });

    const last = promptText(model, 2);
    expect(last).toContain('Você é uma vovó italiana.');
    expect(conversation(model, 2)).not.toContain('resposta antiga');
  });

  it('a persona criada aparece no menu como apagável e se apaga por número', async () => {
    const b = await start(scripted(generated));
    await b.receive({ text: '!persona criar uma vovó italiana' });

    await b.receive({ text: '!persona' });
    expect(b.sent).toContainText(/Vovó Italiana 🗑️/);

    await b.receive({ text: '!persona deletar 6' });
    expect(b.sent).toContainText(/apaguei a persona \*Vovó Italiana\*/);
    expect(b.sent).toContainText(/voltei pra padrão/);
  });

  it('persona de fábrica não se apaga', async () => {
    const b = await start(scripted('x'));

    await b.receive({ text: '!persona deletar 1' });

    expect(b.sent).toContainText(/de fábrica, não dá pra apagar/);
  });

  it('persona que sumiu entre o menu e o remove responde opção inválida, não "de fábrica"', async () => {
    const racer = definePlugin({
      name: 'racer',
      version: '0.0.0',
      engine: '<1.0.0',
      setup: (ctx) => {
        const { personas } = ctx.services.get('luma');
        // A persona some entre o `list` e o `remove`: o `remove` real já a acha apagada.
        const remove = personas.remove;
        personas.remove = async (chatId, key) => {
          await remove(chatId, key);
          return remove(chatId, key);
        };
      },
    });
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ a: scripted(generated) }), luma, racer],
      pluginConfig: { ai: { models: [{ model: 'fake:a' }] }, luma: FAST },
    });
    await bot.receive({ text: '!persona criar uma vovó italiana' });

    await bot.receive({ text: '!persona deletar 6' });

    expect(bot.sent).toContainText(/Opção inválida/);
  });

  it('respeita o limite de personas por chat', async () => {
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ a: scripted(generated) }), luma],
      pluginConfig: {
        ai: { models: [{ model: 'fake:a' }] },
        luma: { ...FAST, maxCustomPersonas: 1 },
      },
    });

    await bot.receive({ text: '!persona criar uma vovó italiana' });
    await bot.receive({ text: '!persona criar outro personagem' });

    expect(bot.sent).toContainText(/limite de personas criadas \(1\)/);
  });

  it('se a IA devolve lixo duas vezes, avisa que não rolou e não grava nada', async () => {
    const b = await start(scripted('não sei fazer isso'));

    await b.receive({ text: '!persona criar uma vovó' });
    await b.receive({ text: '!persona' });

    expect(b.sent).toContainText(/não rolou criar essa persona/);
    expect(b.sent).not.toContainText(/🗑️ *$/);
  });

  it('!persona criar sem descrição explica como', async () => {
    const b = await start(scripted('x'));

    await b.receive({ text: '!persona criar' });

    expect(b.sent).toContainText(/me conta como ele é/);
  });
});

describe('ferramentas', () => {
  it('create_persona pela IA cria, ativa e confirma no chat', async () => {
    const generated = JSON.stringify({
      name: 'Pirata',
      description: '🏴‍☠️',
      context: 'Você é um pirata.',
      style: 'arr',
      traits: ['a', 'b', 'c'],
    });
    const model = scripted(
      toolAnswer('create_persona', { description: 'um pirata mal-humorado' }),
      generated,
      'arr, agora sou pirata',
    );
    const b = await start(model);

    await b.receive({ text: 'vira um pirata mal-humorado' });

    expect(b.sent).toContainText('Prontinho! Agora eu sou *Pirata*! 😎');
  });

  it('clear_history pela IA apaga a memória e não guarda a troca', async () => {
    const model = scripted('lembrei', toolAnswer('clear_history', {}), 'esqueci', 'quem é você?');
    const b = await start(model);
    await b.receive({ text: 'meu segredo é banana' });
    await b.receive({ text: 'esquece tudo' });

    await b.receive({ text: 'o que eu disse?' });

    const prompt = promptText(model, model.doGenerateCalls.length - 1);
    expect(prompt).not.toContain('banana');
    expect(prompt).not.toContain('esquece tudo');
  });
});

describe('mídia', () => {
  it('manda a imagem ao modelo e usa a cadeia de visão, se houver', async () => {
    const text = scripted('x');
    const vision = scripted('é um gato');
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ a: text, v: vision }), luma],
      pluginConfig: {
        ai: { models: [{ model: 'fake:a' }] },
        luma: { ...FAST, visionModels: [{ model: 'fake:v' }] },
      },
    });

    await bot.receive({ text: 'o que é isso?', image: fixtures.image() });

    expect(bot.sent).toHaveReplied('é um gato');
    expect(text.doGenerateCalls).toHaveLength(0);
    const call = vision.doGenerateCalls[0];
    const user = call?.prompt.at(-1);
    expect(JSON.stringify(user)).toContain('"type":"file"');
  });

  it('usa a imagem da mensagem citada', async () => {
    const model = scripted('uma foto');
    const b = await start(model);

    await b.receive({ text: 'descreve', quoted: { image: fixtures.image(), text: 'olha' } });

    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt.at(-1))).toContain('"type":"file"');
    expect(promptText(model)).toContain('[citando');
  });

  it('figurinha sozinha pede para reagir à emoção dela', async () => {
    const model = scripted('kkk');
    const b = await start(model);

    await b.receive({ sticker: fixtures.sticker() });

    expect(promptText(model)).toContain('figurinha/sticker');
  });

  it('áudio: sem o plugin de transcrição, a Luma sabe que não ouve', async () => {
    const model = scripted('não consigo ouvir');
    const b = await start(model);

    await b.receive({ voice: fixtures.voice() });

    expect(promptText(model)).toContain('não consegue ouvir');
  });
});

describe('áudio com o plugin transcribe', () => {
  it('a Luma ouve o áudio pela tool e responde, sem postar a transcrição no chat', async () => {
    // 1ª chamada: a Luma pede a tool; 2ª: o transcribe transcreve; 3ª: a Luma responde.
    const model = scripted(toolAnswer('transcribe_audio', {}), 'quero pizza hoje', 'boa, pizza!');
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ a: model }), transcribe, luma],
      pluginConfig: { ai: { models: [{ model: 'fake:a' }] }, luma: FAST },
    });

    await bot.receive({ voice: fixtures.voice() });

    expect(bot.sent).toHaveReplied('boa, pizza!');
    expect(bot.sent).not.toContainText(/quero pizza hoje/);
    expect(promptText(model, 0)).toContain('Ouça-o com a ferramenta de transcrição');
    // O texto transcrito volta ao modelo como resultado da tool.
    expect(promptText(model, 2)).toContain('quero pizza hoje');
  });
});

describe('quando falha', () => {
  const apiError = new APICallError({
    message: 'http 503',
    url: 'x',
    requestBodyValues: {},
    statusCode: 503,
  });

  it('IA fora do ar: responde na voz da Luma, sem vazar o erro', async () => {
    const b = await start(scripted(apiError));

    await b.receive({ text: 'oi' });

    expect(b.sent).toHaveReplied('Tô sem cabeça agora, volta daqui a pouco.');
  });

  it('erro inesperado: responde uma das frases de erro e segue o jogo', async () => {
    const b = await start(
      scripted(
        new APICallError({ message: 'ruim', url: 'x', requestBodyValues: {}, statusCode: 400 }),
      ),
    );

    await b.receive({ text: 'oi' });

    expect(b.sent).toContainText(/Ahn\?|Não entendi direito|cera no ouvido/);
  });

  it('sem cadeia configurada, avisa em vez de calar', async () => {
    bot = await createTestBot({ plugins: [ai, luma], pluginConfig: { luma: FAST } });

    await bot.receive({ text: 'oi' });

    expect(bot.sent).toHaveReplied('Tô sem cabeça agora, volta daqui a pouco.');
  });

  it('resposta vazia sem nenhuma tool: responde uma frase de erro', async () => {
    const b = await start(scripted(textAnswer('')));

    await b.receive({ text: 'oi' });

    expect(b.sent).toContainText(/Ahn\?|Não entendi direito|cera no ouvido/);
  });
});

describe('outros plugins', () => {
  it('conta a interação no rank, se ele existe', async () => {
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ a: scripted('oi') }), luma, rank],
      pluginConfig: { ai: { models: [{ model: 'fake:a' }] }, luma: FAST },
    });

    await bot.receive({ text: 'oi', sender: { id: 'ana@x', name: 'Ana' } });
    await bot.receive({ text: '!rank global' });

    expect(bot.sent).toContainText(/Ana|@/);
    expect(bot.sent).toContainText(/— 1/);
  });

  it('funciona sem o rank nem o user-names', async () => {
    const b = await start(scripted('oi'));

    await b.receive({ text: 'oi' });

    expect(b.sent).toHaveReplied('oi');
  });
});
