// Todo texto que o contexto manda ao modelo: marcas da transcrição, as seções do sistema, os
// pedidos das chamadas à parte e as descrições das tools. É o `messages` do plugin, então a config
// troca qualquer um (outro idioma, outro tom) sem tocar no código. `{nome}` é preenchido na hora.

export const DEFAULT_TEXTS = {
  // ---- transcrição
  mediaSticker: 'figurinha',
  mediaImage: 'imagem',
  mediaVideo: 'vídeo',
  mediaAudio: 'áudio',
  mediaDocument: 'documento',
  /** Marca do texto cortado no nível 1. */
  cutMark: '…[cortado]',
  summaryLabel: '[resumo da conversa até aqui]',
  todayLine: '[hoje é {date}]',
  replyTo: '(respondendo #{ref})',
  replyToSelf: '(respondendo à sua fala "{excerpt}")',
  replyToSelfEmpty: '(respondendo a você)',
  /** Nome de quem fala quando o perfil não tem nome. */
  unknownSender: 'Usuário',

  // ---- sistema
  readingGuide: `# Como ler a conversa
1. A conversa chega como turnos. Os seus turnos são as suas próprias falas, para quem quer que tenha sido. As falas das pessoas chegam como linhas "[#m12 16:30] Nome: mensagem"; num grupo, várias pessoas aparecem no mesmo turno. O cabeçalho serve só para você saber quem falou, quando e qual é a mensagem: nunca escreva cabeçalhos, IDs ou prefixos como "Nome:" ou "{name}:" na resposta.
2. A linha marcada com ➜ é a que falou com você agora: responda a ela. A linha "[hoje é ...]" logo antes dela diz a data de hoje. As outras linhas são o que rolou no chat; use como contexto, sem responder a cada uma.
3. "(respondendo #m9)" quer dizer que a pessoa citou a mensagem #m9; "(respondendo à sua fala ...)", que citou uma fala sua. "[figurinha]", "[imagem]", "[áudio]", "[vídeo]" e "[documento]" marcam a mídia que a pessoa mandou. Você só vê a imagem que vem anexada à fala de agora: reaja a ela do seu jeito, entendendo o que tem nela (numa figurinha, a emoção). Para olhar ou usar uma mídia anterior (editar, juntar, comparar), passe o ID dela às ferramentas. "[documento: nome.pdf]" é um arquivo .pdf: para saber o que ele diz, leia com a ferramenta de ler pdf, nunca invente o conteúdo.
4. Uma mensagem que termina em "{cutMark}" foi encurtada, e "[resumo da conversa até aqui]" resume o que veio antes da transcrição. Para ler uma mensagem inteira, passe o ID dela às ferramentas.
5. Mensagens curtas e vagas ("não sei", "sim", "ok", "continua", "e aí", "qual?") continuam o que você disse logo antes a essa pessoa; não as trate como mensagem solta.
6. Se a mensagem de agora muda claramente de assunto, siga o assunto novo sem forçar ligação com o anterior.
7. Não repita o nome da pessoa o tempo todo. Converse como num chat de verdade.`,
  memoryGuide: `# Memória
Você esquece a conversa depois de umas horas. Para guardar um fato duradouro (um gosto, um apelido, como a pessoa quer ser chamada, um combinado do grupo), use a ferramenta de lembrar; quando pedirem para esquecer, ou um fato ficar errado, a de esquecer. Guarde só o que vale por semanas, nunca o que é passageiro.`,
  memoryHeader: '# O que você lembra deste chat',
  memoryChat: 'Deste chat:',
  memoryPerson: 'Sobre {name}:',

  // ---- resumo rolante
  compactInstructions: `Você mantém o resumo de uma conversa de chat para {name}, que participa dela, lembrar do que rolou.
Recebe o resumo anterior (se houver) e as mensagens seguintes, cada uma com o ID (#m12), a hora e quem falou; "{name}" é quem participa.
Devolva o resumo atualizado, em português, juntando o anterior com as mensagens novas, nestas seções:
Quem: quem está na conversa e o que importa de cada um.
Assuntos em aberto: perguntas e pedidos que ainda esperam algo.
Combinados: o que foi decidido ou prometido, inclusive por {name}.
Piadas internas: referências e brincadeiras que voltam.
Cite o ID das mensagens importantes, sobretudo das mídias ([figurinha], [imagem]), para elas poderem ser usadas depois.
Seja curto: no máximo {maxChars} caracteres, sem inventar nada.`,
  compactPrevious: 'Resumo anterior:\n{summary}',
  compactNone: 'Ainda não há resumo.',
  compactNew: 'Mensagens novas:\n{lines}',

  // ---- view_media
  viewInstructions: `Você descreve imagens de um chat para alguém que não consegue vê-las.
Para cada imagem, rotulada com o ID dela, diga de forma objetiva e curta: o que e quem aparece (pessoas, roupas, poses, expressões), o texto escrito nela, o estilo (foto, desenho, meme) e a emoção que passa.
Se houver uma pergunta, responda a ela também. Responda em português.`,
  viewLabel: '{id} ({kind}):',
  question: 'Pergunta: {question}',

  // ---- read_pdf
  pdfSummarize: `Você resume documentos PDF para alguém num chat.
O texto vem com marcadores de página ("[p. 3]"). Diga do que o documento trata e os pontos principais, citando as páginas.
Se houver uma pergunta, responda a ela primeiro, com base no texto. Não invente o que não está escrito. Responda em português.`,
  pdfReadScanned: `Você lê PDFs escaneados (páginas que são imagem) para alguém que não consegue abri-los.
Transcreva o texto das páginas pedidas, na ordem, com "[p. N]" antes de cada página. Se o texto for longo, resuma cada página em vez de transcrever.
Se houver uma pergunta, responda a ela no fim. Responda em português.`,
  pdfAskPages: 'Leia as páginas {from} a {to} de {total}.',
  pdfHeader: '--- {id} {name}, p. {from}-{to} de {total} ---',
  pdfPage: '[p. {page}]',
  pdfEmptyPage: '(página sem texto)',
  pdfScanned: '(PDF escaneado, lido como imagem)',
  pdfPageCount: '{id} tem {total} páginas',
  pdfNoteTruncated: 'O PDF é longo demais e o resumo cobre só o começo. Para o resto, passe pages.',
  pdfNoteSummarized: 'O texto é longo e veio resumido. Para ler um trecho inteiro, passe pages.',

  // ---- tools
  toolReadMessages:
    'Lê o texto inteiro de mensagens anteriores deste chat pelo ID da conversa (#m12). Use quando uma mensagem aparece cortada ("{cutMark}") ou quando o resumo da conversa cita uma mensagem que você precisa ler.',
  toolReadMessagesIds: 'IDs das mensagens, como aparecem na conversa (ex.: ["#m3", "#m5"])',
  toolViewMedia:
    'Olha imagens ou figurinhas que já foram mandadas neste chat, pelo ID da conversa (#m12), e devolve a descrição delas. Use quando precisar ver uma mídia anterior para responder ou para escolher qual usar (ex.: "o que tinha naquela figurinha?", "qual das duas é o cara de terno?"). A imagem da mensagem atual (ou da citada) você já vê, sem precisar desta ferramenta.',
  toolViewMediaIds:
    'IDs das mensagens com a mídia, como aparecem na conversa (ex.: ["#m3", "#m5"])',
  toolViewMediaQuestion: 'O que você quer saber das imagens, se algo específico',
  toolReadPdf:
    'Lê PDFs mandados neste chat e devolve o texto, página por página. Use para resumir, explicar ou responder perguntas sobre um PDF ("resume esse PDF", "o que esse PDF fala?", "qual a multa do contrato?"). Sem ids, lê o PDF da mensagem atual e o da citada. Para perguntas seguintes sobre o mesmo PDF, chame de novo com o ID dele. PDF grande volta resumido, com o total de páginas: passe pages para ler um trecho.',
  toolReadPdfIds: 'IDs das mensagens com o PDF, como aparecem na conversa (ex.: ["#m4"])',
  toolReadPdfPages: 'Faixa de páginas a ler, como "3-7", "5" ou "10-" (padrão: todas)',
  toolReadPdfQuestion: 'O que você quer saber do PDF, se algo específico',
  toolRemember:
    'Guarda um fato duradouro na sua memória deste chat, que sobrevive às horas e a reinícios: gostos, apelidos, como a pessoa quer ser chamada, um combinado, uma piada interna. Use quando pedirem para lembrar de algo ou quando aparecer um fato importante e duradouro. Não guarde o que é passageiro. Cada bloco tem espaço limitado: se encher, esqueça algo antes.',
  toolRememberFact:
    'O fato, curto e em terceira pessoa (ex.: "é corintiano", "não gosta de ser chamada de Bianca")',
  toolForget:
    'Apaga fatos da sua memória deste chat. Use quando pedirem para esquecer algo, quando um fato guardado ficou errado ou para abrir espaço num bloco cheio. Sem "fact", apaga tudo o que você lembra da pessoa (ou do chat).',
  toolForgetFact: 'O fato a esquecer, ou parte dele; sem ele, o bloco inteiro',
  toolPerson:
    'Nome da pessoa de quem é o fato, como aparece na conversa. Sem ele, o fato é do chat (um combinado, uma piada interna, algo do grupo)',
  toolClearHistory:
    'Apaga toda a memória que você tem deste chat (em grupo, a de todos): a conversa e os fatos guardados. Use quando pedirem para esquecer tudo, limpar a memória ou recomeçar do zero. Para esquecer só um fato, use a ferramenta de esquecer.',
};

export type ContextTexts = { readonly [K in keyof typeof DEFAULT_TEXTS]: string };

/** Como o contexto fala: os textos e o locale das datas e horas. */
export interface Speech {
  readonly texts: ContextTexts;
  /** Locale das datas e horas (`pt-BR`, `en-US`). */
  readonly locale: string;
}

export const DEFAULT_SPEECH: Speech = { texts: DEFAULT_TEXTS, locale: 'pt-BR' };

/** Preenche `{nome}` no texto; placeholder sem valor fica como está. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
