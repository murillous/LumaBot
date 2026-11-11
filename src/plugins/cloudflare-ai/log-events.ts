import { defineLogEvent } from '@usebridger/core';

/** Sem `accountId` e `apiToken`, o provider não entra e os itens `cloudflare:` são pulados. */
export const CLOUDFLARE_DISABLED = defineLogEvent({
  name: 'cloudflare-ai.disabled',
  level: 'info',
  message: 'cloudflare sem conta ou token: provider desligado',
});
