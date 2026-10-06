// Contrato mínimo do transport (ADR 0003). O M1-2 completa eventos, envio, mídia, grupos e
// capabilities; o lifecycle do `Bot` só depende de conectar e desconectar.

export interface Transport {
  /** Identificador do adapter (ex.: `baileys`). */
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
