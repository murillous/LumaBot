// Os plugins do app que registram rotas na API HTTP. Existe só para o `bridger openapi` (script
// `gen:api` do dashboard): o comando importa este módulo para montar a spec, e isso não pode criar
// o bot nem abrir conexão, o que o `bot.ts` faz no topo. Plugin novo com `ctx.http.api` entra aqui.

import { metrics } from '@usebridger/plugin-metrics';
import { ai } from '#plugins/ai/ai.ts';

export const plugins = [metrics, ai];
