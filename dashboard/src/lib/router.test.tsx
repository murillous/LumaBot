// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { matchPath, navigate, setSearch, useSearch } from './router.tsx';

afterEach(() => {
  cleanup();
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
