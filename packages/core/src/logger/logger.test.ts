import { describe, expect, it } from 'vitest';
import {
  createLogger,
  createNoopLogger,
  type LogDestination,
  type LoggerOptions,
} from './logger.ts';

function capture(options: Omit<LoggerOptions, 'destination'> = {}) {
  const raw: string[] = [];
  const destination: LogDestination = { write: (line) => raw.push(line) };
  const log = createLogger({ ...options, destination });
  const lines = (): Record<string, unknown>[] =>
    raw.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { log, raw, lines };
}

describe('createLogger', () => {
  it('emite uma linha JSON com nível, mensagem e campos', () => {
    const { log, lines } = capture();
    log.info('mensagem recebida', { chatId: 'c1', size: 3 });
    expect(lines()).toEqual([
      expect.objectContaining({ level: 30, msg: 'mensagem recebida', chatId: 'c1', size: 3 }),
    ]);
  });

  it('usa info como nível padrão', () => {
    const { log, lines } = capture();
    expect(log.level).toBe('info');
    log.debug('não sai');
    log.info('sai');
    expect(lines().map((line) => line['msg'])).toEqual(['sai']);
  });

  it('respeita o nível configurado', () => {
    const { log, lines } = capture({ level: 'warn' });
    expect(log.level).toBe('warn');
    log.info('não sai');
    log.warn('aviso');
    log.error('erro');
    expect(lines().map((line) => line['msg'])).toEqual(['aviso', 'erro']);
  });

  it('nível trace emite tudo e silent não emite nada', () => {
    const verbose = capture({ level: 'trace' });
    verbose.log.trace('t');
    verbose.log.fatal('f');
    expect(verbose.lines().map((line) => line['level'])).toEqual([10, 60]);

    const silent = capture({ level: 'silent' });
    silent.log.fatal('nada');
    expect(silent.raw).toEqual([]);
  });

  it('não serializa campos em nível desabilitado', () => {
    const { log, raw } = capture({ level: 'error' });
    const fields = {
      get caro(): never {
        throw new Error('campo lido em nível desabilitado');
      },
    };
    log.debug('ignorado', fields);
    expect(raw).toEqual([]);
  });

  it('logs de plugin carregam plugin e chatId', () => {
    const { log, lines } = capture();
    // Como o Bot (M1-16) vai montar: logger do plugin, depois o do chat da mensagem.
    const pluginLog = log.child({ plugin: 'clima' });
    pluginLog.child({ chatId: '123@g.us' }).info('previsão enviada', { cidade: 'Recife' });
    pluginLog.info('setup concluído');

    expect(lines()).toEqual([
      expect.objectContaining({
        plugin: 'clima',
        chatId: '123@g.us',
        cidade: 'Recife',
        msg: 'previsão enviada',
      }),
      expect.objectContaining({ plugin: 'clima', msg: 'setup concluído' }),
    ]);
    expect(lines()[1]).not.toHaveProperty('chatId');
  });

  it('filho herda o nível do pai', () => {
    const { log } = capture({ level: 'error' });
    expect(log.child({ plugin: 'x' }).level).toBe('error');
  });

  it('acrescenta os bindings base a toda linha, inclusive dos filhos', () => {
    const { log, lines } = capture({ bindings: { app: 'meu-bot' } });
    log.info('raiz');
    log.child({ plugin: 'p' }).info('filho');
    expect(lines()).toEqual([
      expect.objectContaining({ app: 'meu-bot', msg: 'raiz' }),
      expect.objectContaining({ app: 'meu-bot', plugin: 'p', msg: 'filho' }),
    ]);
  });

  it('serializa err com message, stack e cause', () => {
    const { log, lines } = capture();
    const cause = new Error('timeout no socket');
    log.error('falha ao enviar', { err: new Error('envio falhou', { cause }) });

    const err = lines()[0]?.['err'] as Record<string, unknown>;
    expect(err).toMatchObject({ type: 'Error', message: 'envio falhou' });
    expect(err['stack']).toEqual(expect.stringContaining('envio falhou'));
    expect(err['cause']).toMatchObject({ type: 'Error', message: 'timeout no socket' });
    expect((err['cause'] as Record<string, unknown>)['stack']).toEqual(
      expect.stringContaining('timeout no socket'),
    );
  });

  it('redact troca os caminhos configurados por [REDACTED]', () => {
    const { log, raw, lines } = capture({ redact: ['config.apiKey', '*.token'] });
    log.info('config carregada', {
      config: { apiKey: 'sk-segredo', modelo: 'x' },
      auth: { token: 'tok-segredo' },
    });

    expect(lines()[0]).toMatchObject({
      config: { apiKey: '[REDACTED]', modelo: 'x' },
      auth: { token: '[REDACTED]' },
    });
    expect(raw.join('')).not.toMatch(/sk-segredo|tok-segredo/);
  });

  it('secrets censura o valor em qualquer lugar da linha', () => {
    const secret = 'sk-"abc"\\123';
    const { log, raw, lines } = capture({ secrets: [secret, ''], bindings: { k: secret } });
    const child = log.child({ plugin: 'ia' });
    child.info(`chamando a API com ${secret}`, { qualquerNome: secret, nested: [{ v: secret }] });
    child.error('falhou', { err: new Error(`401 para a chave ${secret}`) });

    expect(raw).toHaveLength(2);
    for (const line of raw) {
      expect(line).not.toContain('sk-');
      expect(line).toContain('[REDACTED]');
    }
    // A linha continua JSON válido depois da censura.
    expect(lines()[0]).toMatchObject({
      msg: 'chamando a API com [REDACTED]',
      qualquerNome: '[REDACTED]',
      nested: [{ v: '[REDACTED]' }],
      k: '[REDACTED]',
    });
  });

  it('secrets troca inteiro o segredo que contém outro', () => {
    const { log, raw } = capture({ secrets: ['abc', 'abcdef'] });
    log.info('abcdef');
    expect(raw[0]).toContain('"msg":"[REDACTED]"');
  });
});

describe('createNoopLogger', () => {
  it('descarta tudo e devolve a si mesmo como filho', () => {
    const log = createNoopLogger();
    expect(log.level).toBe('silent');
    expect(() => log.fatal('nada', { err: new Error('x') })).not.toThrow();
    expect(log.child({ plugin: 'p' })).toBe(log);
  });

  it('não lê os campos recebidos', () => {
    const log = createNoopLogger();
    const fields = {
      get caro(): never {
        throw new Error('campo lido no logger no-op');
      },
    };
    log.info('x', fields);
    log.child(fields).error('y', fields);
  });
});
