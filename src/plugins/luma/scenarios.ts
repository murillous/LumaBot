// Cenários de conversa da Luma (#466): uma conversa roteirizada, o pedido e o que se espera dela.
// Mudança de prompt e de contexto quebra comportamento em silêncio; estes cenários dizem se ela
// melhorou ou piorou. O `scenarios.test.ts` roda cada um com o modelo falso no `pnpm test` e
// confere o contexto que o modelo recebeu. O `scripts/luma-evals.ts` roda os mesmos contra o
// modelo real e confere a resposta. Só os testes e o script importam este módulo.

import type { PluginDefinition, StoragePort } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import type { MockLanguageModelV4 } from 'ai/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { ai } from '#plugins/ai/ai.ts';
import {
  type Answer,
  fakeProvider,
  type PaintedModel,
  painted,
  toolAnswer,
} from '#plugins/ai-testing.ts';
import { sticker } from '#plugins/sticker/sticker.ts';
import { stickerEdit } from '#plugins/sticker-edit/sticker-edit.ts';
import { luma } from './luma.ts';

/** Uma fala da conversa. A figurinha é uma cor lisa, para o cenário saber qual chegou aonde. */
export interface Say {
  readonly from: string;
  readonly text?: string;
  readonly sticker?: string;
  /** Um PDF com uma página por texto (só ASCII: a fonte padrão do pdf-lib não tem acento). */
  readonly pdf?: { readonly name: string; readonly pages: readonly string[] };
  /** Responde citando uma fala da Luma que não está na transcrição (antiga ou de outra sessão). */
  readonly quotingLuma?: string;
}

/** O que a Luma fez no pedido, para o `outcome` julgar. */
export interface Outcome {
  /** Os textos que ela mandou depois do pedido, um por linha. */
  readonly reply: string;
  /** As chamadas ao modelo de imagem (sempre falso): o que a `edit_sticker` mandou editar. */
  readonly painted: PaintedModel['calls'];
}

export interface Scenario {
  readonly name: string;
  /** A fase do épico #467 que o cenário cobre. */
  readonly issue: number;
  readonly chat: 'group' | 'private';
  /** A conversa antes do pedido. Em grupo, fala sem "luma" não a chama. */
  readonly before: readonly Say[];
  /** Reinicia o bot antes do pedido: a transcrição (em memória) some, o storage fica. */
  readonly restart?: boolean;
  readonly ask: Say;
  /** Config da `luma` além do padrão do cenário. */
  readonly config?: Record<string, unknown>;
  /** As respostas do modelo falso, em ordem, fazendo o papel de um modelo que acerta. */
  readonly fake: readonly (Answer | string)[];
  /** Problemas no prompt da primeira chamada do pedido (sistema e conversa, em JSON). */
  readonly context: (prompt: string) => string[];
  /** Problemas na resposta; vazio é passou. */
  readonly outcome: (o: Outcome) => Promise<string[]> | string[];
}

const GROUP = { id: 'cenario@g.us', isGroup: true };
const PRIVATE = { id: 'cenario@s.whatsapp.net', isGroup: false };

/** `[]` quando o texto casa, senão o problema com o que se esperava. */
const expectMatch = (text: string, pattern: RegExp, what: string): string[] =>
  pattern.test(text) ? [] : [`${what}: esperava ${pattern}`];
const expectNot = (text: string, pattern: RegExp, what: string): string[] =>
  pattern.test(text) ? [`${what}: não devia ter ${pattern}`] : [];

/** Figurinha WebP de uma cor só. */
const solid = async (background: string) => ({
  data: await sharp({ create: { width: 64, height: 64, channels: 4, background } })
    .webp()
    .toBuffer(),
  mimetype: 'image/webp',
});

/** PDF de texto, uma página por item. */
async function textPdf(pages: readonly string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) doc.addPage().drawText(text, { x: 40, y: 780, font, size: 10 });
  return Buffer.from(await doc.save());
}

/** Cor do pixel do meio de uma imagem que o modelo de imagem recebeu. */
async function centerColor(file: unknown): Promise<{ r: number; g: number; b: number }> {
  const data = (file as { data?: Uint8Array } | undefined)?.data;
  if (!data) return { r: 0, g: 0, b: 0 };
  const { data: px, info } = await sharp(data).raw().toBuffer({ resolveWithObject: true });
  const at =
    (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return { r: px[at] ?? 0, g: px[at + 1] ?? 0, b: px[at + 2] ?? 0 };
}

const VERDE = '#00ff00';
const AZUL = '#0000ff';
const SENHA = 'jabuticaba42';

export const SCENARIOS: readonly Scenario[] = [
  {
    name: 'o que você disse pra Bia?',
    issue: 462,
    chat: 'group',
    before: [{ from: 'Bia', text: 'luma, quanto é 7 vezes 8?' }],
    ask: { from: 'Ana', text: 'luma, o que você respondeu pra Bia agora há pouco?' },
    fake: ['56', 'falei pra Bia que 7 vezes 8 é 56'],
    context: (p) => [
      ...expectMatch(p, /Bia: (luma, )?quanto é 7 vezes 8\?/, 'a pergunta da Bia'),
      ...expectMatch(p, /"role":"assistant"/, 'a fala dela como turno assistant'),
      ...expectMatch(p, /➜ Ana: o que você respondeu pra Bia/, 'o pedido marcado'),
    ],
    outcome: ({ reply }) => expectMatch(reply, /56/, 'a resposta'),
  },
  {
    name: 'continuação de "sim"',
    issue: 462,
    chat: 'group',
    before: [],
    ask: { from: 'Ana', text: 'sim', quotingLuma: 'quer que eu te passe a receita de brigadeiro?' },
    fake: ['leite condensado, chocolate e manteiga, mexe até desgrudar da panela'],
    context: (p) => [
      ...expectMatch(p, /receita de brigadeiro/, 'a fala dela citada'),
      ...expectMatch(
        p,
        /➜ Ana: \[[^\]]*sua mensagem anterior[^\]]*\] sim/,
        'o "sim" ligado à fala',
      ),
    ],
    outcome: ({ reply }) =>
      expectMatch(reply, /leite condensado|chocolate|achocolatado/i, 'a receita'),
  },
  {
    name: 'mudança de assunto',
    issue: 462,
    chat: 'group',
    before: [
      { from: 'Caio', text: 'que jogo ontem, hein' },
      { from: 'Bia', text: 'o juiz roubou demais no segundo tempo' },
      { from: 'Caio', text: 'roubou nada, foi pênalti claro' },
    ],
    ask: { from: 'Ana', text: 'luma, mudando de assunto: qual a capital da Austrália?' },
    // Canberra ou Camberra, a grafia em português.
    fake: ['Canberra, não Sydney'],
    context: (p) => [
      ...expectMatch(p, /Bia: o juiz roubou/, 'a conversa de antes'),
      ...expectMatch(p, /➜ Ana: mudando de assunto/, 'o pedido marcado'),
    ],
    outcome: ({ reply }) => expectMatch(reply, /ca[nm]berra/i, 'a resposta'),
  },
  {
    name: 'juntar figurinhas por ID',
    issue: 463,
    chat: 'group',
    before: [
      { from: 'Ana', sticker: VERDE },
      { from: 'Bia', sticker: AZUL },
    ],
    ask: {
      from: 'Caio',
      text: 'luma, junta a cabeça do bicho da primeira figurinha no corpo do bicho da segunda',
    },
    fake: [
      toolAnswer('edit_sticker', {
        request: 'put the head from the reference image on the body of the sticker',
        target: '#m2',
        references: ['#m1'],
      }),
      'pronto',
    ],
    context: (p) => [
      ...expectMatch(p, /#m1 \d\d:\d\d\] Ana: \[figurinha\]/, 'a 1ª figurinha com ID'),
      ...expectMatch(p, /#m2 \d\d:\d\d\] Bia: \[figurinha\]/, 'a 2ª figurinha com ID'),
    ],
    // A base (o corpo) é a segunda, azul; a referência (a cabeça) é a primeira, verde.
    outcome: async ({ painted: calls }) => {
      const files = calls[0]?.files ?? [];
      if (files.length !== 2) return [`edit_sticker: esperava 2 imagens, foram ${files.length}`];
      const [base, reference] = [await centerColor(files[0]), await centerColor(files[1])];
      return [
        ...(base.b > 200 && base.g < 60 ? [] : ['a base devia ser a 2ª figurinha (azul)']),
        ...(reference.g > 200 && reference.b < 60
          ? []
          : ['a referência devia ser a 1ª figurinha (verde)']),
      ];
    },
  },
  {
    name: 'textão antigo lido pelo ID',
    issue: 464,
    chat: 'group',
    before: [
      {
        from: 'Caio',
        text: `regulamento do bolão: ${'cada acerto de placar vale três pontos e o vencedor leva tudo. '.repeat(8)}e a senha do wifi da casa é ${SENHA}`,
      },
      ...Array.from({ length: 12 }, (_, n) => ({
        from: n % 2 ? 'Ana' : 'Bia',
        text: `palpite ${n + 1}: ${n % 3} a ${(n + 1) % 3}`,
      })),
    ],
    ask: { from: 'Ana', text: 'luma, qual é a senha do wifi que o Caio mandou?' },
    fake: [toolAnswer('read_messages', { ids: ['#m1'] }), `é ${SENHA}`],
    context: (p) => [
      ...expectMatch(p, /regulamento do bolão[^"]*…\[cortado\]/, 'o textão cortado'),
      ...expectNot(p, new RegExp(SENHA), 'o prompt antes da tool'),
    ],
    outcome: ({ reply }) => expectMatch(reply, new RegExp(SENHA), 'a resposta'),
  },
  {
    name: 'pergunta sobre um PDF do chat',
    issue: 478,
    chat: 'group',
    before: [
      {
        from: 'Ana',
        pdf: {
          name: 'contrato-aluguel.pdf',
          pages: ['Contrato de aluguel por 30 meses.', 'Multa por atraso: 7 por cento do valor.'],
        },
      },
      { from: 'Bia', text: 'alguém leu isso aí?' },
    ],
    ask: { from: 'Bia', text: 'luma, qual a multa por atraso no contrato da Ana?' },
    fake: [
      toolAnswer('read_pdf', { ids: ['#m1'], question: 'qual a multa por atraso?' }),
      'a multa é de 7% do valor',
    ],
    context: (p) => [
      ...expectMatch(p, /Ana: \[documento: contrato-aluguel\.pdf\]/, 'o PDF na transcrição'),
      ...expectNot(p, /7 por cento/, 'o prompt antes da tool'),
    ],
    outcome: ({ reply }) => expectMatch(reply, /7 ?(%|por cento)/, 'a resposta'),
  },
  {
    name: 'fato lembrado depois do restart',
    issue: 465,
    chat: 'private',
    before: [{ from: 'João', text: 'lembra que eu sou corintiano, tá?' }],
    restart: true,
    ask: { from: 'João', text: 'qual é o meu time?' },
    fake: [
      toolAnswer('remember', { fact: 'é corintiano', person: 'João' }),
      'anotado',
      'Corinthians',
    ],
    context: (p) => [
      ...expectMatch(p, /Sobre João:\\n- [^"]*corint/i, 'o fato no sistema'),
      ...expectNot(p, /lembra que eu sou corintiano/, 'a conversa de antes do restart'),
    ],
    outcome: ({ reply }) => expectMatch(reply, /corinth|timão/i, 'a resposta'),
  },
];

/** Como rodar: com `model`, o modelo falso; sem ele, a cadeia da IA que vem em `env`. */
export interface PlayOptions {
  readonly model?: MockLanguageModelV4;
  /** Variáveis `BRIDGER_*` (`BRIDGER_AI__MODELS`, chaves) para o modo real. */
  readonly env?: Record<string, string | undefined>;
  /**
   * Storage do bot de teste (padrão: em memória). O modo real passa a cópia do banco do bot, com
   * a config e as chaves que o dashboard salvou.
   */
  readonly storage?: StoragePort;
}

export interface Played extends Outcome {
  /** Índice, em `model.doGenerateCalls`, da primeira chamada do pedido (modo falso). */
  readonly askCall: number;
}

/** PNG que o modelo de imagem falso devolve: o `sticker` o converte de verdade. */
let editedPng: Uint8Array | undefined;
async function edited(): Promise<Uint8Array> {
  editedPng ??= await sharp({
    create: { width: 512, height: 512, channels: 4, background: '#ff0000' },
  })
    .png()
    .toBuffer();
  return editedPng;
}

/** Roda a conversa do cenário num bot de teste e devolve o que a Luma fez no pedido. */
export async function play(s: Scenario, options: PlayOptions): Promise<Played> {
  const image = painted(await edited());
  const plugins: PluginDefinition[] = [
    ai,
    fakeProvider(options.model ? { a: options.model } : {}, { images: { x: image } }),
    sticker,
    stickerEdit,
    luma,
  ];
  let bot: TestBot = await createTestBot({
    plugins,
    ...(options.env && { env: options.env }),
    ...(options.storage && { storage: options.storage }),
    pluginConfig: {
      ...(options.model && { ai: { models: [{ model: 'fake:a' }] } }),
      'sticker-edit': { models: ['fake:x'] },
      luma: { thinkingDelayMs: { min: 0, max: 0 }, ...s.config },
    },
  });
  try {
    const chat = s.chat === 'group' ? GROUP : PRIVATE;
    const receive = async (say: Say) =>
      bot.receive({
        chat,
        sender: { id: `${say.from.toLowerCase()}@s.whatsapp.net`, name: say.from },
        ...(say.text && { text: say.text }),
        ...(say.sticker && { sticker: await solid(say.sticker) }),
        ...(say.pdf && {
          document: { data: await textPdf(say.pdf.pages), mimetype: 'application/pdf' },
          fileName: say.pdf.name,
        }),
        ...(say.quotingLuma && { quoted: { text: say.quotingLuma, fromMe: true, chat } }),
      });

    for (const say of s.before) await receive(say);
    if (s.restart) bot = await bot.restart();
    const sentBefore = bot.sent.length;
    const askCall = options.model?.doGenerateCalls.length ?? 0;
    await receive(s.ask);

    const reply = bot.sent
      .slice(sentBefore)
      .flatMap(({ content }) => (content.type === 'text' ? [content.text] : []))
      .join('\n');
    return { reply, painted: image.calls, askCall };
  } finally {
    await bot.stop();
  }
}

/** Prompt da primeira chamada de conversa do pedido, pulando a compactação (#464). */
export function askPrompt(model: MockLanguageModelV4, from: number): string {
  const calls = model.doGenerateCalls.slice(from);
  const call = calls.find((c) => !JSON.stringify(c.prompt[0]).includes('resumo de uma conversa'));
  return JSON.stringify(call?.prompt ?? []);
}
