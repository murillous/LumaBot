import { defineLogEvent } from '@usebridger/core';

export const MODELS_EMPTY = defineLogEvent({
  name: 'ai.models.empty',
  level: 'warn',
  message: 'nenhum modelo em models: a IA vai recusar até ser configurada',
});

export const OBSERVER_FAILED = defineLogEvent({
  name: 'ai.observer.failed',
  level: 'error',
  message: 'observer da IA falhou',
});

export const KEYS_UNREADABLE = defineLogEvent({
  name: 'ai.keys.unreadable',
  level: 'warn',
  message: 'não foi possível ler a fonte das chaves da IA',
});

export const HTTP_DISABLED = defineLogEvent({
  name: 'ai.http.disabled',
  level: 'info',
  message: 'sem http no bot: rotas do ai desligadas',
});

export const PROVIDER_UNREGISTERED = defineLogEvent({
  name: 'ai.provider.unregistered',
  level: 'error',
  message: 'provider não registrado (falta a chave ou o plugin)',
});

export const SEARCH_UNSUPPORTED = defineLogEvent({
  name: 'ai.search.unsupported',
  level: 'warn',
  message: 'provider sem busca nativa; item pulado',
});

export const GENERATE_DONE = defineLogEvent({
  name: 'ai.generate.done',
  level: 'info',
  message: 'ia respondeu',
});

export const MODEL_FAILED = defineLogEvent({
  name: 'ai.model.failed',
  level: 'warn',
  message: 'modelo falhou, tentando o próximo',
});
