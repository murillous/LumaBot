// Fonte viva de segredos para o logger. A lista fixa de `createLogger({ secrets })` não basta
// para a config de plugin: ela é resolvida depois que o logger existe e muda no reload. Quem
// cria o bot compartilha um `SecretSet` entre o logger e a config; o logger relê os valores só
// quando `version` muda, então o custo por linha é uma comparação de número.

/** O que o logger consulta: os valores atuais e um contador que muda junto com eles. */
export interface SecretSource {
  /** Muda sempre que o conjunto de valores muda. */
  readonly version: number;
  values(): readonly string[];
}

/** Segredos agrupados por dono (ex.: `plugin:ai`), para trocar os de um sem tocar nos outros. */
export interface SecretSet extends SecretSource {
  /** Substitui os segredos do dono. Lista vazia equivale a `delete`. */
  set(owner: string, values: readonly string[]): void;
  delete(owner: string): void;
}

export function createSecretSet(): SecretSet {
  const byOwner = new Map<string, readonly string[]>();
  let version = 0;
  let cached: readonly string[] | undefined;

  const changed = (): void => {
    version += 1;
    cached = undefined;
  };

  return {
    get version(): number {
      return version;
    },
    values(): readonly string[] {
      cached ??= [...new Set([...byOwner.values()].flat())];
      return cached;
    },
    set(owner: string, values: readonly string[]): void {
      const kept = values.filter((value) => value.length > 0);
      if (kept.length === 0) {
        if (byOwner.delete(owner)) changed();
        return;
      }
      byOwner.set(owner, [...kept]);
      changed();
    },
    delete(owner: string): void {
      if (byOwner.delete(owner)) changed();
    },
  };
}
