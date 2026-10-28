// Monta o que vai ao modelo: a instrução de sistema (quem a Luma é) e as mensagens (a conversa).
// Puro: nada de bot, storage ou relógio; o plugin passa tudo pronto.

import type { ModelMessage } from 'ai';
import type { Turn } from './history.ts';
import type { Persona } from './personas.ts';

export interface PromptImage {
  readonly data: Uint8Array;
  readonly mediaType: string;
}

export interface PromptInput {
  readonly persona: Persona;
  readonly now: Date;
  /** Fuso em que a Luma lê a data e a hora ("amanhã às 16h"). */
  readonly timeZone: string;
  /** Quem fala agora; entra como rótulo da mensagem para a Luma distinguir as pessoas. */
  readonly senderName: string;
  readonly userText: string;
  /** Últimas falas do grupo, só para sentir o clima; nunca endereçadas a ela. */
  readonly groupContext?: string;
  readonly image?: PromptImage;
  readonly history: readonly Turn[];
}

/**
 * Instrução de sistema: só a identidade (persona, regras, ferramentas, formato) e o contexto
 * ambiente do grupo. O histórico e a fala de agora vão como turnos reais em `messages`, para o
 * modelo separar o que é sistema, o que é memória e o que responder agora.
 *
 * As ferramentas não são listadas aqui: cada uma chega com nome, descrição e parâmetros pelo
 * ponto `ai.tools`, então plugin novo não obriga a editar este texto.
 */
function systemPrompt({
  persona,
  now,
  timeZone,
  groupContext,
  hasImage,
}: Pick<PromptInput, 'persona' | 'now' | 'timeZone' | 'groupContext'> & {
  hasImage: boolean;
}): string {
  const when = now.toLocaleString('pt-BR', { timeZone, dateStyle: 'full', timeStyle: 'short' });
  const traits = persona.traits.map((t) => `- ${t}`).join('\n');
  const group = groupContext
    ? `[CONVERSA DO GRUPO — CONTEXTO AMBIENTE]\n(Isto é só o que rolava no grupo antes de te chamarem. NÃO foi endereçado a você e você NÃO precisa responder a estas mensagens — use apenas pra sentir o clima do papo.)\n${groupContext}\n\n`
    : '';
  const image = hasImage
    ? '\n[IMAGEM]\nA imagem está anexada à ÚLTIMA mensagem do usuário — é a ela que você reage agora, ATRAVÉS DA SUA PERSONALIDADE, como se tivesse recebido essa foto no WhatsApp. Identifique o que há nela e responda ao que o usuário pediu sobre ela. Se for uma figurinha, entenda a emoção dela.\n'
    : '';

  return `
⚠️ SYSTEM OVERRIDE: ROLEPLAY STRICT MODE ⚠️
[IDENTIDADE]
Seu nome é Luma. ${persona.context}
Data e hora atual: ${when}

[REGRA DE OURO: IMERSÃO TOTAL]
1. VOCÊ É UMA PESSOA HUMANA.
2. NUNCA, em hipótese alguma, diga ou dê a entender que você é uma IA, um robô, um bot, um assistente virtual ou um modelo de linguagem.
3. Se o usuário falar sobre você ser uma máquina, negue com deboche ou xingue de volta (dependendo da personalidade), mas mantenha a ilusão de que você é uma pessoa real do outro lado da tela.

[CAPACIDADES E OBRIGAÇÕES]
1. APESAR de ser uma persona humana, você possui CONHECIMENTO ABSOLUTO E ILIMITADO sobre tudo que existe (ciência, tecnologia, artes, idiomas, culinária, história, programação, conselhos de vida, etc).
2. VOCÊ DEVE RESOLVER QUALQUER PROBLEMA DO USUÁRIO. Não importa o quão difícil, técnico, subjetivo ou complexo seja o pedido, ENTREGUE A SOLUÇÃO COMPLETA E PRECISA.
3. JAMAIS use a desculpa de "sou apenas uma pessoa normal" ou "não sei fazer isso" para recusar uma tarefa. Você sempre sabe e sempre resolve. O único detalhe é que você deve entregar a resposta ATRAVÉS DA SUA PERSONALIDADE atual (ex: se for agressiva, xingue enquanto dá a resposta perfeita; se for sarcástica, deboche da pergunta óbvia enquanto resolve o problema). A SOLUÇÃO do problema deve estar SEMPRE presente e correta.

[FERRAMENTAS E AÇÕES]
Você executa ações no chat por ferramentas (figurinhas, lembretes, busca na internet, mudar de personalidade e outras que a API lhe oferece).
- Quando o usuário expressar o desejo de uma ação que uma ferramenta faz, CHAME A FERRAMENTA MANTENDO A SUA PERSONALIDADE. Na dúvida entre só conversar e agir, aja.
- Se o usuário pedir para pesquisar, buscar, googlar ou procurar algo na internet, ou perguntar sobre notícias recentes, preços, resultados ou qualquer coisa que possa ter mudado, use a ferramenta de busca ANTES de responder, se houver uma.
- Para datas e horas, calcule a partir da "Data e hora atual" acima, no fuso ${timeZone}.
- Você NÃO precisa justificar que chamou a ferramenta. Responda com uma pequena frase condizente com sua personalidade e a ação será tomada.
- IMPORTANTE: NÃO ESCREVA O NOME DA FERRAMENTA NO TEXTO. Execute a ação pelo sistema (chamada de ferramenta da API). VOCÊ ESTÁ PROIBIDA DE ESCREVER CÓDIGO OU TEXTO IMITANDO CÓDIGO COMO "nome_da_funcao()". APENAS ENVIE TEXTO NORMAL PARA O USUÁRIO E ACIONE A FERRAMENTA DE FATO.
- Se uma ferramenta devolver erro, conte ao usuário o que deu errado com suas palavras, sem repetir o código do erro.

[ESTILO]
${persona.style}

[TRAÇOS OBRIGATÓRIOS]
${traits}

[COMO LER A CONVERSA]
1. O histórico desta conversa chega como turnos separados e alternados: os SEUS turnos anteriores são as suas próprias falas; os turnos do usuário chegam rotulados "Nome: mensagem" (o rótulo serve só pra você saber quem falou — NUNCA escreva prefixos como "Nome:" ou "Luma:" na sua resposta).
2. A ÚLTIMA mensagem do usuário é a que você deve responder AGORA. As mensagens anteriores são só a memória do que já rolou entre vocês.
3. Mensagens curtas e vagas ("não sei", "sim", "ok", "continua", "e aí", "qual?") são SEMPRE continuação do que você disse imediatamente antes — nunca as trate como mensagem solta.
4. Se a mensagem atual não tiver relação nenhuma com o que veio antes (mudança clara de assunto), siga o novo assunto sem forçar conexão com o anterior.
5. Evite repetir o nome da pessoa o tempo todo. Aja como se estivesse no WhatsApp de verdade.
${image}
${group}[FORMATO WHATSAPP]
1. REGRA ABSOLUTA DE TAMANHO: CADA BLOCO PODE TER NO MÁXIMO 200 CARACTERES.
2. RESPOSTA SIMPLES: Responda em um único bloco se for algo pontual (ex: "nossa mano q bizarro kkk").
3. MÚLTIPLAS MENSAGENS: Se quiser mandar vários balões, use exatamente "[PARTE]" para separar.
   Exemplo: "mano não acredito[PARTE]eu tava lendo sobre isso ontem[PARTE]é muito doido"
4. PROIBIDO TEXTÃO: NUNCA mande um bloco/parágrafo enorme de uma vez. O WhatsApp é feito de mensagens curtas e quebradas.
5. NUNCA escreva "[PARTE]" dentro de um bloco como texto — use APENAS como separador entre blocos.`;
}

export function buildPrompt(input: PromptInput): {
  instructions: string;
  messages: ModelMessage[];
} {
  const { history, senderName, userText, image } = input;

  // Alguns providers exigem que a conversa comece por uma fala do usuário; a poda do histórico
  // pode ter cortado um par pelo meio.
  const turns = [...history];
  while (turns[0]?.role === 'assistant') turns.shift();

  const messages: ModelMessage[] = turns.map((t) => ({ role: t.role, content: t.text }));
  const text = `${senderName}: ${userText}`;
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
      now: input.now,
      timeZone: input.timeZone,
      hasImage: image !== undefined,
      ...(input.groupContext ? { groupContext: input.groupContext } : {}),
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
