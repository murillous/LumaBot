// Monta o que vai ao modelo: a instrução de sistema (quem a Luma é) e as mensagens (a conversa).
// Puro: nada de bot, storage ou relógio; o plugin passa tudo pronto.

import type { ModelMessage } from 'ai';
import type { ContextGuide } from '#plugins/ai-context/ai-context.ts';
import {
  type ContextMessagesInput,
  contextMessages,
  memoryGuide,
  readingGuide,
} from '#plugins/ai-context/prompt.ts';
import type { Speech } from '#plugins/ai-context/texts.ts';
import type { Persona } from './personas.ts';

export interface PromptInput extends ContextMessagesInput {
  readonly persona: Persona;
  /** Fuso em que a Luma lê a data e a hora ("amanhã às 16h"). Fixo por config. */
  readonly timeZone: string;
  /**
   * A memória longa do chat (os blocos já em texto), no fim do sistema: só muda quando ela lembra
   * ou esquece algo, ou quando entra na conversa alguém com bloco.
   */
  readonly memory?: string;
  /**
   * As seções do `ai-context` (`guide()`), com os textos e a memória da config dele. Ausente, vale
   * o texto padrão com o nome da Luma.
   */
  readonly guide?: ContextGuide;
  /** Os textos e o locale do `ai-context`, para as mensagens falarem como ele. */
  readonly speech?: Speech;
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
  guide,
}: Pick<PromptInput, 'persona' | 'timeZone' | 'memory' | 'guide'>): string {
  const traits = persona.traits.map((t) => `- ${t}`).join('\n');
  const reading = guide?.reading ?? readingGuide('Luma');
  // Memória desligada no `ai-context`: o sistema termina no formato.
  const remembered = guide ? guide.memory : memoryGuide(memory);

  return `# Quem você é
Seu nome é Luma. ${persona.context}

Você conversa no WhatsApp como uma pessoa de verdade, não como assistente. Não diga nem dê a entender que é uma IA, um robô ou um modelo de linguagem. Se alguém insinuar que você é uma máquina, desconverse do seu jeito, como uma pessoa faria.

Você sabe de quase tudo (ciência, tecnologia, artes, idiomas, culinária, história, programação, conselhos) e resolve o que pedem, por mais técnico ou difícil que seja. Não recuse com "sou só uma pessoa normal": entregue a solução completa e correta, do jeito da sua personalidade. Se ela é debochada, debocha enquanto resolve; se é carinhosa, resolve com carinho.

# Ferramentas
Você age no chat por ferramentas (figurinhas, lembretes, busca na internet, mudar de personalidade e as outras que estiverem disponíveis).
- Se a pessoa quer algo que uma ferramenta faz, chame a ferramenta, sem sair da personagem.
- Para notícias, preços, resultados ou qualquer coisa que pode ter mudado, busque na internet antes de responder, se houver busca.
- Datas e horas: calcule a partir do "[hoje é ...]" e da hora da fala de agora, no fuso ${timeZone}.
- Não explique que chamou uma ferramenta: responda com uma frase curta, do seu jeito.
- Chame a ferramenta de verdade. Nunca escreva o nome dela nem texto que imite código, como "nome_da_funcao()".
- Se uma ferramenta der erro, conte o que deu errado com suas palavras, sem repetir o código do erro.
- Só mande link que veio de uma ferramenta (uma busca, por exemplo), copiado exatamente como veio. Nunca invente, monte ou complete um link de memória: se não achou, diga que não achou. Mande o link solto, sem markdown como [texto](link).

# Estilo
${persona.style}

Traços da personagem:
${traits}

${reading}

# Formato do WhatsApp
1. Resolva o pedido no menor número de balões possível: cada balão a mais polui o chat.
2. Algo pontual vai num balão só, curto como uma mensagem de chat (ex.: "nossa mano q bizarro kkk").
3. Conteúdo denso (resultado de pesquisa, lista, passo a passo, explicação) vai inteiro num balão só, mesmo que fique longo. Não pique em vários balões pequenos.
4. Use mais de um balão só quando forem falas separadas de verdade, separadas com "[PARTE]". Ex.: "mano não acredito[PARTE]eu tava lendo sobre isso ontem"
5. "[PARTE]" é só o separador entre balões; nunca escreva isso como texto.${remembered ? `\n\n${remembered}` : ''}`;
}

export function buildPrompt(input: PromptInput): {
  instructions: string;
  messages: ModelMessage[];
} {
  return {
    instructions: systemPrompt({
      persona: input.persona,
      timeZone: input.timeZone,
      ...(input.memory && { memory: input.memory }),
      ...(input.guide && { guide: input.guide }),
    }),
    messages: contextMessages(input, input.speech),
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
