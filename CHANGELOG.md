# Changelog

Todas as mudanças relevantes deste projeto são documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Added

- `ConversationHistory.getTurns()` — retorna turnos com papel real (`user`/`model`), derivado do prefixo `Luma: `.
- `LumaHandler.generateResponse` ganhou a opção `{ persist }` para controlar se a interação é gravada no histórico.

### Changed

- Contexto da Luma migrado de prompt-blob single-turn para pipeline multi-turno: `PromptBuilder.buildConversationRequest` separa `systemInstruction` de `contents` (turnos reais `user`/`model`).
- `GeminiAdapter` agora injeta a persona via `config.systemInstruction` (nativo do Gemini) e a propaga no loop de busca.
- Wrapper OpenAI/DeepSeek em `AIProviderFactory` repassa `systemInstruction` direto e faz busca multi-turn; removido o hack do marcador de texto `[USUÁRIO ATUAL]`.
- Contexto do grupo passou a ser um bloco de ambiente rotulado dentro do `systemInstruction`, explicitamente marcado como contexto (não endereçado à Luma).
- Limite de mensagem unificado em 200 caracteres por bloco (`lumaConfig`), eliminando a contradição 150 vs 200.

### Fixed

- Interações espontâneas gravavam no bucket de histórico errado e poluíam a memória com prompts-de-sistema; agora usam chave alinhada `jid:senderJid` e `{ persist: false }`.
- Mensagem que dispara a Luma aparecia duplicada no contexto de grupo; agora é excluída do `groupContext`.
- Mensagem citada/respondida não entrava no contexto quando o usuário respondia **à própria Luma** (guarda `!isReply` em `LumaHandler.handle`); agora o trecho citado é injetado (`_buildQuotedContext`) com o autor do turno. Reply à **última** fala da Luma (já no histórico) não é reinjetado — evita que ela interprete uma resposta comum como estar sendo "citada/rebatida"; citações de falas dela fora do histórico do interlocutor usam moldura auto-referente ("respondendo a esta sua mensagem"), não "citando Luma".
- Áudio que respondia a um texto/imagem citados descartava esse contexto (`handleAudio`); agora preserva a citação.
- `BaileysAdapter.quotedText` retornava `null` para citações envelopadas (ephemeral/viewOnce); agora desembrulha via `unwrapMessage`, como os demais getters quoted.

[Unreleased]: https://github.com/murillous/LumaBot/commits/main
