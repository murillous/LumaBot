// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { type Handler, LOG_READER, OVERVIEW_ROUTES, OWNER, renderApp } from '#test-support.tsx';

afterEach(cleanup);

const OPEN = {
  status: 'open',
  transport: 'baileys',
  pairing: true,
  account: { id: '1', name: 'Luma', phone: '5511999990000' },
  connectedSince: 1_760_000_000_000,
  reconnections: 2,
};
const CLOSED = {
  status: 'closed',
  reason: 'logged-out',
  transport: 'baileys',
  pairing: true,
  account: null,
  reconnections: 0,
};

const READER = { ...OWNER, name: 'Leitora', permissions: ['connection.read'] };

const conn =
  (body: object): Handler =>
  () => ({ body });

const open = (routes: Record<string, Handler>, me: object = OWNER) =>
  renderApp({ me, routes, path: '/conexao' });

const qrPath = () =>
  screen
    .getByRole('img', { name: /QR code/ })
    .querySelector('path')
    ?.getAttribute('d');

describe('tela Conexão', () => {
  it('mostra carregando e depois a conta conectada com o desvincular', async () => {
    open({ 'GET /api/connection': conn(OPEN) });
    expect(await screen.findByText('conectado')).toBeTruthy();
    expect(screen.getByText('Conta').nextElementSibling?.textContent).toBe('Luma');
    expect(screen.getByText('5511999990000')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Desvincular o WhatsApp' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull();
  });

  it('mostra o erro da API e tenta de novo', async () => {
    const app = open({
      'GET /api/connection': () => ({
        status: 500,
        body: { title: 'Erro', status: 500, detail: 'bot fora' },
      }),
    });
    expect(await screen.findByText('bot fora')).toBeTruthy();
    app.routes['GET /api/connection'] = conn(OPEN);
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('conectado')).toBeTruthy();
  });

  it('sem connection.read, mostra a tela sem permissão e não lê a API', async () => {
    const app = open({}, LOG_READER);
    expect(await screen.findByText('Você não tem permissão para ver esta tela.')).toBeTruthy();
    expect(app.calls.some((c) => c.path === '/api/connection')).toBe(false);
  });

  it('desconectado, sem QR ainda, avisa que aguarda e não tem mais nada de conta', async () => {
    open({ 'GET /api/connection': conn(CLOSED) });
    expect(await screen.findByText('desconectado')).toBeTruthy();
    expect(screen.getByText('logged-out')).toBeTruthy();
    expect(screen.getByText(/Aguardando o QR/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Desvincular/ })).toBeNull();
  });

  it('desenha o QR do evento e o troca quando chega outro', async () => {
    const app = open({ 'GET /api/connection': conn(CLOSED) });
    await screen.findByText('desconectado');
    app.stream().emit('connection.qr', { qr: '2@primeiro-qr', expiresAt: Date.now() + 60_000 });
    const first = await waitFor(() => qrPath());
    expect(first).toMatch(/^M/);
    expect(screen.getByRole('img', { name: /Aparelhos conectados/ })).toBeTruthy();

    app
      .stream()
      .emit('connection.qr', { qr: '2@segundo-qr-diferente', expiresAt: Date.now() + 60_000 });
    await waitFor(() => expect(qrPath()).not.toBe(first));
  });

  it('esquece o QR vencido', async () => {
    const app = open({ 'GET /api/connection': conn(CLOSED) });
    await screen.findByText('desconectado');
    // Margem larga: o QR precisa estar na tela antes de vencer, senão o teste oscila.
    app.stream().emit('connection.qr', { qr: '2@vencido', expiresAt: Date.now() + 600 });
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull(), {
      timeout: 3000,
    });
  });

  it('o evento de status relê a conexão e troca o QR pela conta', async () => {
    const app = open({ 'GET /api/connection': conn(CLOSED) });
    await screen.findByText('desconectado');
    app.stream().emit('connection.qr', { qr: '2@qr', expiresAt: Date.now() + 60_000 });
    await screen.findByRole('img', { name: /QR code/ });
    app.routes['GET /api/connection'] = conn(OPEN);
    app.stream().emit('connection.status', { status: 'open' });
    expect(await screen.findByText('conectado')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull();
  });

  it('pede o código com o telefone, mostra em mono e aceita o do evento', async () => {
    const app = open({
      'GET /api/connection': conn(CLOSED),
      'POST /api/connection/pairing-code': () => ({ body: { code: 'ABCD-1234' } }),
    });
    await screen.findByText('desconectado');
    await userEvent.type(screen.getByLabelText('Telefone'), '5511999990000');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar código' }));
    const code = await screen.findByText('ABCD-1234');
    expect(code.className).toContain('font-mono');
    expect(app.calls.find((c) => c.path === '/api/connection/pairing-code')?.body).toEqual({
      phone: '5511999990000',
    });
    app.stream().emit('connection.pairing-code', { code: 'WXYZ-9876' });
    expect(await screen.findByText('WXYZ-9876')).toBeTruthy();
  });

  it('telefone inválido não chama a API', async () => {
    const app = open({ 'GET /api/connection': conn(CLOSED) });
    await screen.findByText('desconectado');
    await userEvent.type(screen.getByLabelText('Telefone'), '123');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar código' }));
    expect(await screen.findByText(/de 8 a 15 dígitos/)).toBeTruthy();
    expect(app.calls.some((c) => c.path === '/api/connection/pairing-code')).toBe(false);
  });

  it('erro do pedido de código aparece sem derrubar a tela', async () => {
    open({
      'GET /api/connection': conn(CLOSED),
      'POST /api/connection/pairing-code': () => ({
        status: 409,
        body: { title: 'Erro', status: 409, detail: 'sem socket aguardando' },
      }),
    });
    await screen.findByText('desconectado');
    await userEvent.type(screen.getByLabelText('Telefone'), '5511999990000');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar código' }));
    expect(await screen.findByText('sem socket aguardando')).toBeTruthy();
  });

  it('desvincular pede confirmação e só então chama a API', async () => {
    const app = open({
      'GET /api/connection': conn(OPEN),
      'POST /api/connection/logout': () => ({ body: {} }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Desvincular o WhatsApp' }));
    expect(app.calls.some((c) => c.path === '/api/connection/logout')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(app.calls.some((c) => c.path === '/api/connection/logout')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Desvincular o WhatsApp' }));
    app.routes['GET /api/connection'] = conn(CLOSED);
    await userEvent.click(screen.getByRole('button', { name: 'Desvincular' }));
    expect(await screen.findByText('desconectado')).toBeTruthy();
    expect(app.calls.filter((c) => c.path === '/api/connection/logout')).toHaveLength(1);
  });

  it('sem connection.manage a tela é só leitura e não oferece pareamento', async () => {
    const app = open({ 'GET /api/connection': conn(OPEN) }, READER);
    await screen.findByText('conectado');
    expect(screen.queryByRole('button', { name: /Desvincular/ })).toBeNull();

    app.routes['GET /api/connection'] = conn(CLOSED);
    app.stream().emit('connection.status', { status: 'closed' });
    await screen.findByText('desconectado');
    expect(screen.getByText('Parear exige a permissão connection.manage.')).toBeTruthy();
    expect(screen.queryByLabelText('Telefone')).toBeNull();
    expect(screen.queryByText(/Aguardando o QR/)).toBeNull();
    app.stream().emit('connection.qr', { qr: '2@qr', expiresAt: Date.now() + 60_000 });
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull();
  });

  it('o QR que chegou antes de abrir a tela aparece ao entrar nela', async () => {
    const app = renderApp({
      routes: { ...OVERVIEW_ROUTES, 'GET /api/connection': conn(CLOSED) },
      path: '/',
    });
    await screen.findByText('desconectado');
    app.stream().emit('connection.qr', { qr: '2@replay', expiresAt: Date.now() + 60_000 });
    app.stream().emit('connection.pairing-code', { code: 'REPL-0001' });
    await userEvent.click(screen.getByRole('link', { name: 'Conexão' }));
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeTruthy();
    expect(screen.getByText('REPL-0001')).toBeTruthy();
  });

  it('status diferente de connecting descarta o QR e o código; connecting os mantém', async () => {
    const app = open({ 'GET /api/connection': conn(CLOSED) });
    await screen.findByText('desconectado');
    app.stream().emit('connection.qr', { qr: '2@qr', expiresAt: Date.now() + 60_000 });
    app.stream().emit('connection.pairing-code', { code: 'KEEP-0001' });
    await screen.findByRole('img', { name: /QR code/ });
    app.stream().emit('connection.status', { status: 'connecting' });
    expect(screen.getByRole('img', { name: /QR code/ })).toBeTruthy();
    expect(screen.getByText('KEEP-0001')).toBeTruthy();
    app.stream().emit('connection.status', { status: 'closed', reason: 'qr-timeout' });
    await waitFor(() => expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull());
    expect(screen.queryByText('KEEP-0001')).toBeNull();
  });

  it('com pairing falso não oferece desvincular nem código', async () => {
    open({ 'GET /api/connection': conn({ ...OPEN, pairing: false }) });
    await screen.findByText('conectado');
    expect(screen.queryByRole('button', { name: /Desvincular/ })).toBeNull();
  });

  it('desconectado com pairing falso não mostra o campo de código', async () => {
    open({ 'GET /api/connection': conn({ ...CLOSED, pairing: false }) });
    await screen.findByText('desconectado');
    expect(screen.queryByLabelText('Telefone')).toBeNull();
    expect(screen.getByText(/Aguardando o QR/)).toBeTruthy();
  });

  it('sessão já pareada reconectando mostra "Reconectando", sem pareamento', async () => {
    open({ 'GET /api/connection': conn({ ...OPEN, status: 'connecting' }) });
    expect(await screen.findByText(/Reconectando a sessão/)).toBeTruthy();
    expect(screen.queryByText(/Aguardando o QR/)).toBeNull();
  });

  it('connecting com QR em curso mostra o pareamento', async () => {
    const app = open({
      'GET /api/connection': conn({ ...CLOSED, status: 'connecting', qrExpiresAt: 1 }),
    });
    await screen.findByText('conectando');
    app.stream().emit('connection.qr', { qr: '2@qr', expiresAt: Date.now() + 60_000 });
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeTruthy();
  });

  it('leva o foco ao Cancelar e o devolve ao gatilho ao fechar a confirmação', async () => {
    open({ 'GET /api/connection': conn(OPEN) });
    await userEvent.click(await screen.findByRole('button', { name: 'Desvincular o WhatsApp' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Desvincular o WhatsApp' }),
    );
  });
});
