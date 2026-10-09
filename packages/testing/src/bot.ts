// Entry `@zapforge/testing/bot`: o bot de teste e o transport falso, sem registrar os matchers.
// Serve a quem sobe o bot fora do Vitest, como o benchmark: o entry principal importa o `vitest`
// para o `expect.extend`, e isso soma ~6 MB de RSS que não são do kernel.

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
