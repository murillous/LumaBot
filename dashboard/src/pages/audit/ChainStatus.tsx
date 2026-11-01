import { StateWord, type Tone } from '#components/StateWord.tsx';
import { Button } from '#components/ui.tsx';
import { messageOf, type Schemas } from '#lib/api.ts';

export interface Verification {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly data: Schemas['AuditVerifyResult'] | undefined;
  readonly mutate: () => void;
}

/** Estado da cadeia de hash. Nada diz que ela está íntegra até alguém verificar: a conferência
 * percorre a cadeia inteira, então não roda sozinha ao abrir a tela. */
export function ChainStatus({ verify }: { verify: Verification }) {
  let title = 'Cadeia ainda não verificada';
  let text = 'A verificação confere o hash de cada evento, do primeiro ao último.';
  let tone: Tone | null = null;
  if (verify.isPending) {
    title = 'Verificando…';
    text = 'Conferindo o hash de cada evento.';
  } else if (verify.isError) {
    title = 'Não foi possível verificar';
    text = messageOf(verify.error);
    tone = 'danger';
  } else if (verify.data !== undefined) {
    const { ok: intact, checked, brokenAt } = verify.data;
    if (intact) {
      title = 'Cadeia íntegra';
      text = `Conferida agora, ${checked.toLocaleString('pt-BR')} eventos.`;
      tone = 'ok';
    } else {
      title = brokenAt === undefined ? 'Cadeia quebrada' : `Cadeia quebrada no #${brokenAt.seq}`;
      text = brokenAt?.reason ?? 'Um elo não confere com o hash anterior.';
      tone = 'danger';
    }
  }
  return (
    <section aria-label="Cadeia de hash" className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span role="status" className="font-medium">
        {tone === null ? (
          <span className="text-muted">{title}</span>
        ) : (
          <StateWord tone={tone}>{title}</StateWord>
        )}
      </span>
      <span className="min-w-60 flex-1 text-help text-muted">{text}</span>
      <Button disabled={verify.isPending} onClick={() => verify.mutate()}>
        Verificar a cadeia de hash
      </Button>
    </section>
  );
}
