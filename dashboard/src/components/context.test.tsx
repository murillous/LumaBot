// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppEnv } from '#lib/env.ts';
import { FakeEventSource, OWNER } from '#test-support.tsx';
import { EnvProvider, SessionProvider, useLiveEvent } from './context.tsx';

afterEach(cleanup);

function Probe() {
  const [lines, setLines] = useState<string[]>([]);
  useLiveEvent('log', (data) => setLines((l) => [...l, String((data as { msg: string }).msg)]));
  return <p>{lines.join(',') || 'nada'}</p>;
}

// As telas seguintes assinam tipos do stream pelo `useLiveEvent`, sem abrir outro EventSource.
it('useLiveEvent entrega os eventos do tipo pelo stream único', () => {
  const streams: FakeEventSource[] = [];
  const env: AppEnv = {
    baseUrl: 'http://bot.test',
    fetch: (() => {
      throw new Error('sem rede');
    }) as typeof fetch,
    openEvents: (url) => {
      const source = new FakeEventSource(url);
      streams.push(source);
      return source;
    },
  };
  render(
    <EnvProvider value={env}>
      <SessionProvider me={OWNER} logout={() => undefined}>
        <Probe />
      </SessionProvider>
    </EnvProvider>,
  );

  expect(streams).toHaveLength(1);
  streams[0]?.emit('log', { msg: 'um' });
  streams[0]?.emit('connection', { msg: 'outro tipo' });
  streams[0]?.emit('log', { msg: 'dois' });
  expect(screen.getByText('um,dois')).toBeTruthy();
});

// Depois que o stream cai de vez, o provider reabre sozinho e os tipos já assinados continuam
// chegando no stream novo.
it('reabre o stream depois de 5 s mantendo as assinaturas', () => {
  const streams: FakeEventSource[] = [];
  const env: AppEnv = {
    baseUrl: 'http://bot.test',
    fetch: (() => {
      throw new Error('sem rede');
    }) as typeof fetch,
    openEvents: (url) => {
      const source = new FakeEventSource(url);
      streams.push(source);
      return source;
    },
  };
  let revalidated = 0;
  render(
    <EnvProvider value={env}>
      <SessionProvider me={OWNER} logout={() => undefined} onStreamClosed={() => revalidated++}>
        <Probe />
      </SessionProvider>
    </EnvProvider>,
  );
  vi.useFakeTimers();
  try {
    streams[0]?.fail(2);
    expect(revalidated).toBe(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(streams).toHaveLength(2);
    streams[1]?.emit('log', { msg: 'depois' });
    expect(screen.getByText('depois')).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});
