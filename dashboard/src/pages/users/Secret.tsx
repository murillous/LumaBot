import { useState } from 'react';
import { Button } from '#components/ui.tsx';
import { messageOf } from '#lib/api.ts';
import { inviteUrl, whenOf } from './format.ts';

export interface Revealed {
  readonly title: string;
  readonly token: string;
  readonly expiresAt: string;
}

/**
 * Link de convite (ou de redefinição de senha) mostrado uma única vez: a API guarda só o hash,
 * então fechar este aviso é perder o link.
 */
export function Secret({ revealed, onClose }: { revealed: Revealed; onClose: () => void }) {
  const [copied, setCopied] = useState<'ok' | { error: string }>();
  const url = inviteUrl(revealed.token);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('ok');
    } catch (error) {
      // Sem permissão de área de transferência (ou contexto inseguro): a pessoa copia à mão.
      setCopied({ error: messageOf(error) });
    }
  };

  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-field bg-warn-soft p-4">
      <p className="font-medium text-warn">{revealed.title}</p>
      <p className="text-warn">
        Copie o link agora: ele não aparece de novo. Vale até {whenOf(revealed.expiresAt)}.
      </p>
      <input
        readOnly
        aria-label="Link do convite"
        value={url}
        onFocus={(event) => event.currentTarget.select()}
        className="min-h-11 w-full rounded-field bg-raised px-3 font-mono text-label text-ink shadow-e1"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void copy()}>Copiar link</Button>
        <Button onClick={onClose}>Já copiei, fechar</Button>
        {copied === 'ok' && (
          <span role="status" className="text-ok">
            Link copiado.
          </span>
        )}
        {copied !== undefined && copied !== 'ok' && (
          <span role="status" className="text-danger">
            Não consegui copiar: {copied.error}. Selecione o link e copie à mão.
          </span>
        )}
      </div>
    </div>
  );
}
