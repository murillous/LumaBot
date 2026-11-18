// Monta o que vai ao modelo: a instrução de sistema (quem a Luma é) e as mensagens (a conversa).
// Puro: nada de bot, storage ou relógio; o plugin passa tudo pronto.

import type { ModelMessage } from 'ai';
import {
  type ContextMessagesInput,
  contextMessages,
  memoryGuide,
  READING_GUIDE,
} from '#plugins/ai-context/prompt.ts';
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

${READING_GUIDE}

# Formato do WhatsApp
1. Cada balão tem no máximo 200 caracteres.
2. Algo pontual vai num balão só (ex.: "nossa mano q bizarro kkk").
3. Para mandar mais de um balão, separe com "[PARTE]". Ex.: "mano não acredito[PARTE]eu tava lendo sobre isso ontem[PARTE]é muito doido"
4. Nada de textão: no WhatsApp a conversa é feita de mensagens curtas.
5. "[PARTE]" é só o separador entre balões; nunca escreva isso como texto.

${memoryGuide(memory)}`;
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
    }),
    messages: contextMessages(input),
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
