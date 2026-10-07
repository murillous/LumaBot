// Contrato do scheduler (M1-11). A implementação é `createSchedulerService` (service.ts); a
// semântica de entrega está em docs/scheduler.md.

import type { JsonValue } from '#storage/types.ts';
import type { Unsubscribe } from '#transport/types.ts';

/** Recebe o payload agendado (`null` quando `at` não recebeu payload). */
export type JobHandler = (payload: JsonValue) => unknown;

/** Agendamento visto pelo plugin (`ctx.scheduler`); jobs ficam no namespace do plugin. */
export interface Scheduler {
  /**
   * Agenda `job` para `when` (Date ou epoch ms) e devolve o id do agendamento. O job é
   * persistido: sobrevive a restart. Horário no passado dispara assim que possível. Rejeita com
   * `TypeError` para horário inválido, nome vazio ou payload que não é JSON.
   */
  at(when: Date | number, job: string, payload?: JsonValue): Promise<string>;
  /** `true` se o agendamento existia e ainda não tinha disparado. */
  cancel(id: string): Promise<boolean>;
  /** Um handler por job; um segundo `on` do mesmo job lança `JobHandlerConflictError`. */
  on(job: string, handler: JobHandler): Unsubscribe;
}
