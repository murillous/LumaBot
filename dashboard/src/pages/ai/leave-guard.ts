import { useEffect } from 'react';

const MESSAGE = 'Há alterações não salvas. Sair desta tela descarta tudo.';

/**
 * Pede confirmação para sair com alteração pendente. O router da Base não tem gancho de
 * bloqueio, então o guarda fica na página: `beforeunload` cobre fechar a aba e recarregar, e um
 * clique em link interno (menu, "voltar") passa por um `confirm` antes de chegar ao `Link`.
 * Limitação: o botão voltar do browser não dá para interceptar sem um gancho no router.
 */
export function useLeaveGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === '_blank' || anchor.origin !== location.origin) return;
      // O painel genérico é carga de página inteira: o `beforeunload` já pergunta.
      if (anchor.pathname.startsWith('/plugins/dashboard')) return;
      // Mesma tela (âncora, link para a própria rota) não perde nada.
      if (anchor.pathname === location.pathname) return;
      if (!window.confirm(MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
    };
  }, [active]);
}
