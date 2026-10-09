// Entry `@zapforge/testing`: o kit de testes para autores de plugin (D22). Importar o pacote
// registra os matchers no `expect` do Vitest.

import './matchers.ts';

export {
  DEFAULT_SELF,
  FakeTransport,
  type FakeTransportOptions,
  type SentMessage,
} from './fake-transport.ts';
export { fixtures, type MediaFixture } from './fixtures.ts';
export {
  DEFAULT_CHAT,
  DEFAULT_SENDER,
  type IncomingMedia,
  type IncomingMessage,
} from './incoming.ts';
export { createTestBot, type TestBot, type TestBotOptions } from './test-bot.ts';
