import { LUMA_CONFIG } from '../../config/lumaConfig.js';

/**
 * Monta a requisição de conversa para a IA separando com clareza as "fontes" de
 * contexto, para a Luma não embaralhá-las:
 *
 * - `systemInstruction`: identidade/persona/regras + contexto ambiente do grupo.
 *   Não é conversa — é quem a Luma é e o clima do grupo.
 * - `contents`: os turnos reais da conversa com papéis (`user`/`model`), seguidos
 *   da mensagem/imagem atual como ÚLTIMO turno `user`. Assim a IA distingue
 *   estruturalmente o que é histórico, o que é a fala de agora e de quem é cada fala.
 *
 * @param {object} params
 * @param {string}      params.userMessage
 * @param {Array<{role:'user'|'model', text:string}>} [params.historyTurns] - de ConversationHistory.getTurns
 * @param {object}      params.personaConfig  - Retorno de PersonalityManager.getPersonaConfig()
 * @param {string}      params.senderName
 * @param {string}      [params.groupContext] - Últimas mensagens do grupo (contexto ambiente)
 * @param {object|null} [params.imageData]    - Dado de imagem em base64 para visão, se disponível
 * @returns {{ systemInstruction: string, contents: Array<{role: string, parts: Array}> }}
 */
export function buildConversationRequest({
  userMessage,
  historyTurns = [],
  personaConfig,
  senderName,
  groupContext = '',
  imageData    = null,
}) {
  const template = imageData
    ? LUMA_CONFIG.SYSTEM_VISION_PROMPT_TEMPLATE
    : LUMA_CONFIG.SYSTEM_PROMPT_TEMPLATE;

  const traitsStr = personaConfig.traits.map(t => `- ${t}`).join('\n');

  // Contexto do grupo entra na instrução de sistema como bloco AMBIENTE e
  // explicitamente rotulado — não é uma fala dirigida à Luma nem parte do
  // histórico dela com o interlocutor atual.
  const groupContextStr = groupContext
    ? `[CONVERSA DO GRUPO — CONTEXTO AMBIENTE]\n(Isto é só o que rolava no grupo antes de te chamarem. NÃO foi endereçado a você e você NÃO precisa responder a estas mensagens — use apenas pra sentir o clima do papo.)\n${groupContext}\n\n`
    : '';

  const now = new Date().toLocaleString('pt-BR', {
    timeZone:   'America/Sao_Paulo',
    dateStyle:  'full',
    timeStyle:  'short',
  });

  const systemInstruction = template
    .replace('{{PERSONALITY_CONTEXT}}', personaConfig.context)
    .replace('{{PERSONALITY_STYLE}}',   personaConfig.style)
    .replace('{{PERSONALITY_TRAITS}}',  traitsStr)
    .replace('{{CURRENT_DATETIME}}',    now)
    .replace('{{GROUP_CONTEXT_PLACEHOLDER}}', groupContextStr);

  // Turnos do histórico viram papéis reais. A API do Gemini exige que o array
  // comece com um turno `user`; descarta turnos `model` órfãos no início (ex.:
  // quando a poda do histórico cortou um par pela metade).
  const turns = [...historyTurns];
  while (turns.length && turns[0].role === 'model') turns.shift();

  const contents = turns.map(t => ({ role: t.role, parts: [{ text: t.text }] }));

  // Mensagem atual: último turno `user`, com o rótulo do autor e a imagem (se houver).
  const currentParts = [{ text: `${senderName}: ${userMessage}` }];
  if (imageData) currentParts.push(imageData);
  contents.push({ role: 'user', parts: currentParts });

  return { systemInstruction, contents };
}
