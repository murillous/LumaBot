import QRCode from 'qrcode';
import { useMemo } from 'react';

/**
 * QR gerado no browser a partir do texto do evento. Desenhado com os tokens `qr-*`, que não mudam
 * com o tema: fundo claro e módulos escuros sempre, ou o WhatsApp não lê.
 */
export function QrCode({ value }: { value: string }) {
  const drawn = useMemo(() => {
    try {
      const { modules } = QRCode.create(value, { errorCorrectionLevel: 'L' });
      let path = '';
      for (let y = 0; y < modules.size; y++) {
        for (let x = 0; x < modules.size; x++) {
          if (modules.get(x, y)) path += `M${x} ${y}h1v1h-1z`;
        }
      }
      return { size: modules.size, path };
    } catch {
      // Texto que o gerador recusa (grande demais): a tela mostra o aviso no lugar do QR.
      return null;
    }
  }, [value]);

  if (drawn === null) return <p className="text-danger">Não foi possível desenhar o QR.</p>;
  const quiet = 4; // margem mínima do padrão do QR, em módulos
  const box = drawn.size + quiet * 2;
  return (
    <svg
      role="img"
      aria-label="QR code de pareamento do WhatsApp. Escaneie em Aparelhos conectados, no celular."
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
      shapeRendering="crispEdges"
      className="h-auto w-full max-w-72 rounded-field bg-qr-bg"
    >
      <path d={drawn.path} className="fill-qr-ink" />
    </svg>
  );
}
