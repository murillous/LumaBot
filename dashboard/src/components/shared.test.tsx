// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { Chip } from './Chip.tsx';
import { Segmented } from './Segmented.tsx';
import { StateWord } from './StateWord.tsx';
import { Switch } from './Switch.tsx';
import { ExpandRow, Table } from './Table.tsx';

afterEach(cleanup);

it('Segmented marca a opção ativa com aria-pressed e troca ao clicar', async () => {
  const user = userEvent.setup();
  function Demo() {
    const [level, setLevel] = useState<'info' | 'warn'>('info');
    return (
      <Segmented
        label="Nível"
        value={level}
        onChange={setLevel}
        options={[
          { value: 'info', label: 'Info' },
          { value: 'warn', label: 'Aviso' },
        ]}
      />
    );
  }
  render(<Demo />);
  expect(screen.getByRole('button', { name: 'Info' }).getAttribute('aria-pressed')).toBe('true');
  await user.click(screen.getByRole('button', { name: 'Aviso' }));
  expect(screen.getByRole('button', { name: 'Aviso' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Info' }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('group', { name: 'Nível' })).toBeTruthy();
});

it('Switch é um role=switch que reflete e inverte o estado', async () => {
  const user = userEvent.setup();
  const seen: boolean[] = [];
  render(<Switch label="Plugin ping" checked={false} onChange={(v) => seen.push(v)} />);
  const control = screen.getByRole('switch', { name: 'Plugin ping' });
  expect(control.getAttribute('aria-checked')).toBe('false');
  await user.click(control);
  expect(seen).toEqual([true]);
});

it('Switch desabilitado não dispara', async () => {
  const user = userEvent.setup();
  const seen: boolean[] = [];
  render(<Switch label="x" checked disabled onChange={(v) => seen.push(v)} />);
  await user.click(screen.getByRole('switch'));
  expect(seen).toEqual([]);
});

it('StateWord e Chip usam a cor do estado', () => {
  render(
    <>
      <StateWord tone="danger">falhou</StateWord>
      <Chip tone="warn">Precisa de atenção</Chip>
    </>,
  );
  expect(screen.getByText('falhou').className).toContain('text-danger');
  expect(screen.getByText('Precisa de atenção').className).toContain('bg-warn-soft');
});

it('ExpandRow expande o detalhe pelo botão com aria-expanded', async () => {
  const user = userEvent.setup();
  function Demo() {
    const [open, setOpen] = useState(false);
    return (
      <Table label="Eventos">
        <tbody>
          <ExpandRow
            cells={['12:00', 'ai.generate.done']}
            expanded={open}
            onToggle={() => setOpen(!open)}
            detail={<p>detalhe do evento</p>}
          />
        </tbody>
      </Table>
    );
  }
  render(<Demo />);
  const toggle = screen.getByRole('button', { name: '12:00' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('detalhe do evento')).toBeNull();
  await user.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('detalhe do evento')).toBeTruthy();
  expect(screen.getByRole('table', { name: 'Eventos' })).toBeTruthy();
});
