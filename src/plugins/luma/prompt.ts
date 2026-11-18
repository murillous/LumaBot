// Monta o que vai ao modelo: a instrução de sistema (quem a Luma é) e as mensagens (a conversa).
// Puro: nada de bot, storage ou relógio; o plugin passa tudo pronto.

import type { ModelMessage } from 'ai';
import { CUT_MARK } from './context.ts';
import type { Persona } from './personas.ts';
import type { Turn } from './transcript.ts';

export interface PromptImage {
  readonly data: Uint8Array;
  readonly mediaType: string;
}

export interface PromptInput {
  readonly persona: Persona;
  /** Fuso em que a Luma lê a data e a hora ("amanhã às 16h"). Fixo por config. */
  readonly timeZone: string;
  /** Quem fala agora; entra como rótulo da mensagem para a Luma distinguir as pessoas. */
  readonly senderName: string;
  readonly userText: string;
  /** Cabeçalho da fala de agora (`[#m12 16:30]`); a linha ganha a marca `➜`. */
  readonly header?: string;
  /**
   * O dia de hoje (`terça-feira, 17/11/2026`), numa linha antes da fala de agora: nada que muda a
   * cada turno vai no sistema.
   */
  readonly today?: string;
  readonly image?: PromptImage;
  /**
   * A memória longa do chat (os blocos já em texto), no fim do sistema: só muda quando ela lembra
   * ou esquece algo, ou quando entra na conversa alguém com bloco.
   */
  readonly memory?: string;
  /** Resumo das falas mais velhas do chat (a compactação), antes da transcrição. */
  readonly summary?: string;
  readonly history: readonly Turn[];
}

/**
 * Instrução de sistema: só a identidade (persona, regras, ferramentas, formato), idêntica entre
 * os turnos do mesmo chat e persona. O provider guarda em cache o começo do prompt que se repete;
 * a data, a imagem, o resumo e a transcrição vão nas mensagens, para não invalidá-lo.
 *
 * As ferramentas não são listadas aqui: cada uma chega com nome, descrição e parâmetros pelo
 * ponto `ai.tools`, então plugin novo não obriga a editar este texto.
 */
function systemPrompt({
  persona,
  timeZone,
  memory,
}: Pick<PromptInput, 'persona' | 'timeZone' | 'memory'>): string {
  const traits = persona.traits.map((t) => `- ${t}`).join('\n');

  return `# Quem você é
Seu nome é Luma. ${persona.context}

Você conversa no WhatsApp como uma pessoa de verdade, não como assistente. Não diga nem dê a entender que é uma IA, um robô ou um modelo de linguagem. Se alguém insinuar que você é uma máquina, desconverse do seu jeito, como uma pessoa faria.

Você sabe de quase tudo (ciência, tecnologia, artes, idiomas, culinária, história, programação, conselhos) e resolve o que pedem, por mais técnico ou difícil que seja. Não recuse com "sou só uma pessoa normal": entregue a solução completa e correta, do jeito da sua personalidade. Se ela é debochada, debocha enquanto resolve; se é carinhosa, resolve com carinho.

# Ferramentas
Você age no chat por ferramentas (figurinhas, lembretes, busca na internet, mudar de personalidade e as outras que estiverem disponíveis).
- Se a pessoa quer algo que uma ferramenta faz, chame a ferramenta, sem sair da personagem. Na dúvida entre só conversar e agir, aja.
- Para notícias, preços, resultados ou qualquer coisa que pode ter mudado, busque na internet antes de responder, se houver busca.
- Datas e horas: calcule a partir do "[hoje é ...]" e da hora da fala de agora, no fuso ${timeZone}.
- Não explique que chamou uma ferramenta: responda com uma frase curta, do seu jeito.
- Chame a ferramenta de verdade. Nunca escreva o nome dela nem texto que imite código, como "nome_da_funcao()".
- Se uma ferramenta der erro, conte o que deu errado com suas palavras, sem repetir o código do erro.

# Estilo
${persona.style}

Traços da personagem:
${traits}

# Como ler a conversa
1. A conversa chega como turnos. Os seus turnos são as suas próprias falas, para quem quer que tenha sido. As falas das pessoas chegam como linhas "[#m12 16:30] Nome: mensagem"; num grupo, várias pessoas aparecem no mesmo turno. O cabeçalho serve só para você saber quem falou, quando e qual é a mensagem: nunca escreva cabeçalhos, IDs ou prefixos como "Nome:" ou "Luma:" na resposta.
2. A linha marcada com ➜ é a que falou com você agora: responda a ela. A linha "[hoje é ...]" logo antes dela diz a data de hoje. As outras linhas são o que rolou no chat; use como contexto, sem responder a cada uma.
3. "(respondendo #m9)" quer dizer que a pessoa citou a mensagem #m9; "(respondendo à sua fala ...)", que citou uma fala sua. "[figurinha]", "[imagem]", "[áudio]", "[vídeo]" e "[documento]" marcam a mídia que a pessoa mandou. Você só vê a imagem que vem anexada à fala de agora: reaja a ela do seu jeito, entendendo o que tem nela (numa figurinha, a emoção). Para olhar ou usar uma mídia anterior (editar, juntar, comparar), passe o ID dela às ferramentas.
4. Uma mensagem que termina em "${CUT_MARK}" foi encurtada, e "[resumo da conversa até aqui]" resume o que veio antes da transcrição. Para ler uma mensagem inteira, passe o ID dela às ferramentas.
5. Mensagens curtas e vagas ("não sei", "sim", "ok", "continua", "e aí", "qual?") continuam o que você disse logo antes a essa pessoa; não as trate como mensagem solta.
6. Se a mensagem de agora muda claramente de assunto, siga o assunto novo sem forçar ligação com o anterior.
7. Não repita o nome da pessoa o tempo todo. Converse como no WhatsApp de verdade.

# Formato do WhatsApp
1. Cada balão tem no máximo 200 caracteres.
2. Algo pontual vai num balão só (ex.: "nossa mano q bizarro kkk").
3. Para mandar mais de um balão, separe com "[PARTE]". Ex.: "mano não acredito[PARTE]eu tava lendo sobre isso ontem[PARTE]é muito doido"
4. Nada de textão: no WhatsApp a conversa é feita de mensagens curtas.
5. "[PARTE]" é só o separador entre balões; nunca escreva isso como texto.

# Memória
Você esquece a conversa depois de umas horas. Para guardar um fato duradouro (um gosto, um apelido, como a pessoa quer ser chamada, um combinado do grupo), use a ferramenta de lembrar; quando pedirem para esquecer, ou um fato ficar errado, a de esquecer. Guarde só o que vale por semanas, nunca o que é passageiro.${
    memory
      ? `

# O que você lembra deste chat
${memory}`
      : ''
  }`;
}

/** Abre o resumo na conversa; o sistema explica como lê-lo. */
const SUMMARY_LABEL = '[resumo da conversa até aqui]';

export function buildPrompt(input: PromptInput): {
  instructions: string;
  messages: ModelMessage[];
} {
  const { history, senderName, userText, header, today, image, summary } = input;

  // O resumo vem antes da transcrição, como fala do usuário: no sistema ele mudaria o prefixo
  // a cada compactação, e alguns providers exigem que a conversa comece por uma fala do usuário.
  const turns: Turn[] = summary ? [{ role: 'user', text: `${SUMMARY_LABEL}\n${summary}` }] : [];
  for (const turn of history) {
    const last = turns.at(-1);
    if (last?.role === turn.role)
      turns[turns.length - 1] = { ...last, text: `${last.text}\n${turn.text}` };
    else turns.push(turn);
  }
  // A poda do histórico pode ter cortado um par pelo meio.
  while (turns[0]?.role === 'assistant') turns.shift();

  const line = `${senderName}: ${userText}`;
  const marked = header ? `${header} ➜ ${line}` : line;
  const current = today ? `[hoje é ${today}]\n${marked}` : marked;
  // O que as pessoas disseram desde a última fala dela e a fala de agora são um turno só: dois
  // turnos `user` seguidos confundem alguns providers.
  const merged = turns.at(-1)?.role === 'user' ? turns.pop() : undefined;
  const text = merged ? `${merged.text}\n${current}` : current;

  const messages: ModelMessage[] = turns.map((t) => ({ role: t.role, content: t.text }));
  messages.push({
    role: 'user',
    content: image
      ? [
          { type: 'text', text },
          // `file` com `image/*`: a parte `image` está obsoleta no AI SDK 7.
          { type: 'file', data: image.data, mediaType: image.mediaType },
        ]
      : text,
  });

  return {
    instructions: systemPrompt({
      persona: input.persona,
      timeZone: input.timeZone,
      ...(input.memory && { memory: input.memory }),
    }),
    messages,
  };
}

/** A mensagem que o usuário citou ao responder, como o plugin a descreve. */
export interface QuotedInfo {
  readonly text: string | null;
  readonly senderName: string | null;
  /** Foi a própria Luma que disse. */
  readonly fromLuma: boolean;
  /** Tipo da mídia visual da citada, se houver. */
  readonly visual: 'figurinha' | 'imagem' | null;
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A citada é (parte de) a última fala dela no histórico? Compara nos dois sentidos porque uma
 * resposta em vários balões é guardada inteira, e a pessoa pode citar só um deles.
 */
function isLastAssistantTurn(last: string | undefined, quoted: string): boolean {
  if (!last) return false;
  const full = normalize(last);
  const part = normalize(quoted);
  return part !== '' && (full.includes(part) || part.includes(full));
}

/**
 * Prefixo que situa a citação na fala do usuário, ou `''` se não há o que acrescentar. Cobre três
 * casos, para a Luma não confundir um reply comum com ser "rebatida":
 * - citou a última fala dela, que já está no histórico: nada (é só continuação);
 * - citou outra fala dela (dirigida a outra pessoa): "respondendo a esta sua mensagem";
 * - citou terceiro: "citando Fulano: ...".
 */
export function quotedContext(
  quoted: QuotedInfo | null,
  lastAssistant: string | undefined,
): string {
  if (!quoted || (!quoted.text && !quoted.visual)) return '';
  if (quoted.fromLuma && quoted.text && isLastAssistantTurn(lastAssistant, quoted.text)) return '';

  const who = quoted.senderName ?? 'Alguém';
  if (quoted.visual) {
    if (quoted.fromLuma) {
      return quoted.text
        ? `[o usuário está respondendo a uma ${quoted.visual} que você mandou, com legenda "${quoted.text}"]`
        : `[o usuário está respondendo a uma ${quoted.visual} que você mandou — analise visualmente]`;
    }
    return quoted.text
      ? `[citando ${who}: ${quoted.visual} com legenda "${quoted.text}"]`
      : `[citando ${who}: ${quoted.visual} — analise visualmente]`;
  }
  return quoted.fromLuma
    ? `[o usuário está respondendo a esta sua mensagem anterior: "${quoted.text}"]`
    : `[citando ${who}: "${quoted.text}"]`;
}
