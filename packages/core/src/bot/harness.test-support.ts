// Apoio aos testes do pipeline do Bot (M1-16). Não é exportado. O core não usa o
// `@zapforge/testing`, que depende dele (ADR 0053).

import type { LogFields, Logger, LogLevel } from '#logger/types.ts';
import type { Contact, TextMessage } from '#message/types.ts';
import type { Capability } from '#transport/capabilities.ts';
import { TestTransport, textMessage } from '#transport/fake-transport.test-support.ts';

export interface LogLine {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: LogFields;
}

/** Logger que guarda as linhas; `child` acumula os bindings nos campos. */
export function recordingLogger(lines: LogLine[] = []): Logger & { readonly lines: LogLine[] } {
  const make = (bindings: LogFields): Logger & { readonly lines: LogLine[] } => {
    const at =
      (level: LogLevel) =>
      (message: string, fields?: LogFields): void => {
        lines.push({ level, message, fields: { ...bindings, ...fields } });
      };
    return {
      lines,
      level: 'trace',
      trace: at('trace'),
      debug: at('debug'),
      info: at('info'),
      warn: at('warn'),
      error: at('error'),
      fatal: at('fatal'),
      child: (more) => make({ ...bindings, ...more }),
    };
  };
  return make({});
}

/** Transport de teste que registra `connect`/`disconnect` e pode falhar ou travar o connect. */
export class RecordingTransport extends TestTransport {
  readonly calls: string[] = [];
  /** Erros que os próximos `connect()` lançam, um por chamada. */
  readonly connectFailures: Error[] = [];
  /** Admin e membro comum de todo grupo, segundo `getGroupMetadata` do `TestTransport`. */
  readonly admin: Contact = { id: 'owner@test', name: 'Dona', phone: null };
  readonly member: Contact = { id: 'member@test', name: null, phone: null };

  constructor(capabilities: Iterable<Capability> = ['send.text', 'quoted']) {
    super(capabilities);
  }

  override async connect(): Promise<void> {
    this.calls.push('connect');
    const failure = this.connectFailures.shift();
    if (failure) throw failure;
    await super.connect();
  }

  override async disconnect(): Promise<void> {
    this.calls.push('disconnect');
    await super.disconnect();
  }
}

let nextId = 0;

/** Mensagem de texto com id único e remetente configurável. */
export function message(
  text: string,
  options: { chatId?: string; sender?: Partial<Contact>; fromMe?: boolean } = {},
): TextMessage {
  nextId++;
  return textMessage(text, {
    id: `in-${nextId}`,
    chat: { id: options.chatId ?? 'chat@test', isGroup: false },
    sender: { id: 'user@test', name: 'Usuária', phone: null, ...options.sender },
    fromMe: options.fromMe ?? false,
  });
}

/** Textos enviados pelo transport, na ordem. */
export function sentTexts(transport: TestTransport): string[] {
  return transport.sent.map((record) =>
    record.content.type === 'text' ? record.content.text : `<${record.content.type}>`,
  );
}

/** Promise controlável por fora, para segurar um handler no meio. */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
