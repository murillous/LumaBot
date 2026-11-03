import { useEffect, useRef, useState } from 'react';
import { Button, Card } from '#components/ui.tsx';
import type { Schemas } from '#lib/api.ts';

type Copy = 'idle' | 'copied' | 'failed';

/** Mostra o segredo da chave recém-criada. A API só o entrega uma vez; fechar o descarta. */
export function CreatedSecret({
  created,
  onClose,
}: {
  created: Schemas['ApiKeyCreated'];
  onClose: () => void;
}) {
  const [copy, setCopy] = useState<Copy>('idle');
  const card = useRef<HTMLDivElement>(null);
  // O segredo surge depois de um clique que some da tela; sem levar o foco, nada é anunciado.
  useEffect(() => card.current?.focus(), []);

  const copyIt = async () => {
    try {
      await navigator.clipboard.writeText(created.secret);
      setCopy('copied');
    } catch {
      // Sem permissão de clipboard (ou contexto inseguro): a pessoa copia selecionando o texto.
      setCopy('failed');
    }
  };

  return (
    <Card
      ref={card}
      tabIndex={-1}
      role="region"
      aria-label="Chave criada"
      className="flex flex-col gap-3"
    >
      <p className="font-medium">Chave "{created.name}" criada</p>
      <p className="text-warn">
        Copie agora: esta chave não aparece de novo. Se perder, revogue e crie outra.
      </p>
      <code className="select-all break-all rounded-field bg-sunken p-3 font-mono text-label">
        {created.secret}
      </code>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void copyIt()}>Copiar</Button>
        <Button onClick={onClose}>Já copiei, fechar</Button>
        <span role="status" className="text-help">
          {copy === 'copied' && <span className="text-ok">Copiado.</span>}
          {copy === 'failed' && (
            <span className="text-danger">Não consegui copiar. Selecione o texto e copie.</span>
          )}
        </span>
      </div>
    </Card>
  );
}
