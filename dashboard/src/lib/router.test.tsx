// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import {
  confirmLeave,
  Link,
  matchPath,
  navigate,
  setSearch,
  useLeaveGuard,
  usePath,
  useSearch,
} from './router.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

function Filters() {
  const search = useSearch();
  return <p>nivel={search.get('nivel') ?? '-'}</p>;
}

it('useSearch acompanha a query e setSearch a troca sem mudar o caminho', () => {
  history.replaceState(null, '', '/logs?nivel=warn');
  render(<Filters />);
  expect(screen.getByText('nivel=warn')).toBeTruthy();

  act(() => setSearch(new URLSearchParams({ nivel: 'error' })));
  expect(screen.getByText('nivel=error')).toBeTruthy();
  expect(location.pathname + location.search).toBe('/logs?nivel=error');

  act(() => setSearch(new URLSearchParams()));
  expect(screen.getByText('nivel=-')).toBeTruthy();
  expect(location.search).toBe('');
});

it('replace troca a entrada do histórico em vez de empilhar', () => {
  history.replaceState(null, '', '/logs');
  const before = history.length;
  act(() => setSearch(new URLSearchParams({ q: 'a' }), { replace: true }));
  expect(history.length).toBe(before);
  act(() => navigate('/ia', { replace: true }));
  expect(history.length).toBe(before);
  act(() => navigate('/logs'));
  expect(history.length).toBe(before + 1);
});

it('matchPath não casa parâmetro com % solto, em vez de lançar', () => {
  expect(matchPath('/plugins/:nome', '/plugins/ai')).toEqual({ nome: 'ai' });
  expect(matchPath('/plugins/:nome', '/plugins/%E0%A4%A')).toBeNull();
  expect(matchPath('/plugins/:nome', '/logs/ai')).toBeNull();
});

function Guarded({ when = true }: { when?: boolean }) {
  useLeaveGuard(when, 'Descarta?');
  const path = usePath();
  return (
    <>
      <p>em={path}</p>
      <Link to="/outra">ir</Link>
    </>
  );
}

// O happy-dom não tem `window.confirm`.
const confirmWith = (answer: boolean) => {
  const ask = vi.fn(() => answer);
  window.confirm = ask;
  return ask;
};

it('guarda: link e navigate perguntam; recusar fica, aceitar sai', async () => {
  history.replaceState(null, '', '/tela');
  render(<Guarded />);
  const ask = confirmWith(false);

  await userEvent.click(screen.getByText('ir'));
  act(() => navigate('/outra'));
  expect(ask).toHaveBeenCalledWith('Descarta?');
  expect(location.pathname).toBe('/tela');

  ask.mockReturnValue(true);
  await userEvent.click(screen.getByText('ir'));
  expect(location.pathname).toBe('/outra');
});

it('guarda: mudar só a query não pergunta; sem guarda ativa também não', () => {
  history.replaceState(null, '', '/tela');
  const ask = confirmWith(false);
  const { rerender } = render(<Guarded />);
  act(() => setSearch(new URLSearchParams({ a: '1' })));
  expect(ask).not.toHaveBeenCalled();

  rerender(<Guarded when={false} />);
  act(() => navigate('/outra'));
  expect(ask).not.toHaveBeenCalled();
  expect(location.pathname).toBe('/outra');
  expect(confirmLeave()).toBe(true);
});

it('guarda: voltar recusado refaz a URL; aceito segue', () => {
  history.replaceState(null, '', '/anterior');
  history.pushState(null, '', '/tela');
  render(<Guarded />);
  const ask = confirmWith(false);

  // O voltar do browser chega com a `location` já trocada.
  history.replaceState(null, '', '/anterior');
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(location.pathname).toBe('/tela');
  expect(screen.getByText('em=/tela')).toBeTruthy();

  ask.mockReturnValue(true);
  history.replaceState(null, '', '/anterior');
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(location.pathname).toBe('/anterior');
  expect(screen.getByText('em=/anterior')).toBeTruthy();
});

it('guarda: beforeunload só é cancelado enquanto ativa', () => {
  const { rerender } = render(<Guarded />);
  const during = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(during);
  expect(during.defaultPrevented).toBe(true);

  rerender(<Guarded when={false} />);
  const after = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});
