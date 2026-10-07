# Logger

`createLogger` cria o logger estruturado do kernel: uma linha JSON por chamada, sobre pino. A
API pública é a interface `Logger` — o pino não aparece nela, então plugins não dependem dele.

```ts
import { createLogger } from '@zapforge/core';

const log = createLogger({ level: 'debug', bindings: { app: 'meu-bot' } });

log.info('bot iniciado');
log.warn('fila cheia', { chatId, pending: 100 });
log.error('falha ao enviar', { err });
```

Assinatura de todo método: `log.<nível>(mensagem, campos?)`. Os campos entram na linha ao lado
de `level`, `time`, `pid`, `hostname` e `msg`.

## Opções

| Opção | Padrão | O que faz |
| --- | --- | --- |
| `level` | `'info'` | Nível mínimo: `trace`, `debug`, `info`, `warn`, `error`, `fatal` ou `silent` |
| `destination` | stdout | Qualquer `{ write(line: string): void }` — recebe cada linha JSON com `\n` |
| `bindings` | — | Campos presentes em toda linha deste logger e dos filhos |
| `redact` | — | Caminhos de campos trocados por `[REDACTED]` (sintaxe do pino) |
| `secrets` | — | Valores trocados por `[REDACTED]` em qualquer lugar da linha: lista fixa ou `SecretSet` (fonte viva) |

O core não lê variável de ambiente: o nível vem de quem cria o logger (config do bot / app).

## Contexto: `plugin` e `chatId`

`child(bindings)` devolve um logger que acrescenta os campos a toda linha; filhos de filhos
acumulam. O `Bot` dá a cada plugin `ctx.log = root.child({ plugin })`, e o que roda por mensagem
recebe o filho com o chat:

```ts
const pluginLog = root.child({ plugin: 'clima' });
pluginLog.child({ chatId: message.chat.id }).info('previsão enviada', { cidade });
// {"level":30,...,"plugin":"clima","chatId":"123@g.us","cidade":"Recife","msg":"previsão enviada"}
```

O filho herda nível, destino e redação do pai. Repetir uma chave num filho (`child({ chatId })`
sobre um logger que já tem `chatId`) gera a chave duas vezes na linha; leitores de JSON ficam
com a última. Crie o filho a partir do logger do plugin, não do filho de outro chat.

## Erros

Passe o erro no campo **`err`**: ele é serializado com `type`, `message`, `stack` e a `cause`
(recursiva, também com stack). Em outro nome de campo o `Error` vira `{}` no JSON.

```ts
log.error('falha ao enviar', { err: new Error('envio falhou', { cause }) });
```

## Segredos

Duas camadas, combináveis:

- **`secrets`** (por valor) — a lista de valores secretos, por exemplo os campos `secret` da
  config já validada. Qualquer ocorrência na linha vira `[REDACTED]`: na mensagem, em qualquer
  campo, nos bindings e em `err.message`/`err.stack`. É a proteção que não depende de saber
  onde o segredo vai aparecer — use-a para os segredos da config.
- **`redact`** (por caminho) — nomes de campo que nunca saem, qualquer que seja o valor:
  `['password', 'config.apiKey', '*.token']` (`*` casa um nível). Útil para campos sensíveis
  cujo valor não se conhece de antemão (token de sessão recebido em runtime).

```ts
createLogger({ secrets: [config.openai.apiKey], redact: ['*.token'] });
```

Segredos descobertos depois da criação do logger — a config de plugin é resolvida no setup e
muda no reload — entram por uma fonte viva: passe um `SecretSet` em vez da lista. O logger (e
todos os filhos) relê os valores quando o conjunto muda; a config de plugin escreve nele
([Config](config.md#segredos)).

```ts
const secrets = createSecretSet();
const log = createLogger({ secrets });
secrets.set('plugin:ai', [apiKey]);   // a partir daqui, apiKey sai como [REDACTED]
secrets.delete('plugin:ai');
```

Limites: com lista fixa, os segredos são fixados na criação (filhos herdam); um segredo muito
curto ou comum censura também o texto que coincidir com ele. String vazia é ignorada.

## Logger silencioso

`createNoopLogger()` descarta tudo sem ler os campos nem alocar — para testes e como padrão
quando ninguém passou logger. `child()` devolve o próprio no-op.

## Desempenho

Em nível desabilitado o pino não serializa nada; os campos só são lidos quando a linha sai. A
censura por `secrets` roda só nas linhas emitidas e só quando há segredo configurado (com
`SecretSet`, a lista é recalculada só quando o conjunto muda).

## Saída legível em dev

O core não traz `pino-pretty`. Para ler os logs no terminal, o app pode encaminhar a saída:

```sh
node app.js | npx pino-pretty
```
