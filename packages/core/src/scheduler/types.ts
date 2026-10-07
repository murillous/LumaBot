// Contrato do scheduler (M1-11). O M1-11 completa este arquivo; os nomes exportados aqui são
// usados por outros módulos e não mudam.

import type { JsonValue } from '#storage/types.ts';
import type { Unsubscribe } from '#transport/types.ts';

export type JobHandler = (payload: JsonValue) => unknown;

/** Agendamento visto pelo plugin (`ctx.scheduler`); jobs ficam no namespace do plugin. */
export interface Scheduler {
  /** Agenda `job` para `when` (Date ou epoch ms) e devolve o id do agendamento. */
  at(when: Date | number, job: string, payload?: JsonValue): Promise<string>;
  /** `true` se o agendamento existia e ainda não tinha disparado. */
  cancel(id: string): Promise<boolean>;
  on(job: string, handler: JobHandler): Unsubscribe;
}
