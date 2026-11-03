import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApi, useLiveEvent, useSession } from '#components/context.tsx';
import { PageTitle } from '#components/PageTitle.tsx';
import { StateWord } from '#components/StateWord.tsx';
import { Button, Card, ErrorNotice, Field, inputClass } from '#components/ui.tsx';
import { ok, type Schemas } from '#lib/api.ts';
import { QrCode } from './connection/QrCode.tsx';
import { STATUS } from './overview/Connection.tsx';
import { useConnection } from './overview/queries.ts';
import { Remote } from './overview/Remote.tsx';

type Connection = Schemas['Connection'];

const KEY = ['overview', 'connection'];
const PHONE = /^\d{8,15}$/;

interface Qr {
  readonly qr: string;
  readonly expiresAt: number | undefined;
}

const isQr = (data: unknown): data is Schemas['ConnectionQrEvent']['data'] =>
  typeof data === 'object' &&
  data !== null &&
  'qr' in data &&
  typeof data.qr === 'string' &&
  data.qr !== '';

function codeOf(data: unknown): string | undefined {
  if (typeof data === 'object' && data !== null && 'code' in data) {
    return typeof data.code === 'string' && data.code !== '' ? data.code : undefined;
  }
  return undefined;
}

function Account({ connection }: { connection: Connection }) {
  const account = connection.account;
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1">
      {account && (
        <>
          <dt className="text-muted">Conta</dt>
          <dd>{account.name ?? account.username ?? account.phone ?? account.id}</dd>
          {account.phone && (
            <>
              <dt className="text-muted">Telefone</dt>
              <dd className="font-mono text-label">{account.phone}</dd>
            </>
          )}
        </>
      )}
      {connection.connectedSince !== undefined && (
        <>
          <dt className="text-muted">Conectado desde</dt>
          <dd>{new Date(connection.connectedSince).toLocaleString('pt-BR')}</dd>
        </>
      )}
      <dt className="text-muted">Transporte</dt>
      <dd className="font-mono text-label">{connection.transport}</dd>
      <dt className="text-muted">Reconexões</dt>
      <dd>{connection.reconnections}</dd>
    </dl>
  );
}

function Logout() {
  const api = useApi();
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);
  const logout = useMutation({
    mutationFn: () => ok(api.client.POST('/api/connection/logout')),
    onSettled: () => {
      setAsking(false);
      return client.invalidateQueries({ queryKey: KEY });
    },
  });
  return (
    <div className="flex flex-col items-start gap-3">
      {logout.isError && <ErrorNotice error={logout.error} />}
      {asking ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-field bg-warn-soft p-4"
        >
          <p className="text-warn">
            Desvincular encerra a sessão do WhatsApp. A Luma para de responder até você parear de
            novo.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={logout.isPending} onClick={() => logout.mutate()}>
              Desvincular
            </Button>
            <Button onClick={() => setAsking(false)}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <Button variant="danger" onClick={() => setAsking(true)}>
          Desvincular o WhatsApp
        </Button>
      )}
    </div>
  );
}

function PairingCode({
  code,
  onCode,
}: {
  code: string | undefined;
  onCode: (code: string) => void;
}) {
  const api = useApi();
  const [phone, setPhone] = useState('');
  const [invalid, setInvalid] = useState(false);
  const request = useMutation({
    mutationFn: (value: string) =>
      ok(api.client.POST('/api/connection/pairing-code', { body: { phone: value } })),
    onSuccess: (data) => onCode(data.code),
  });
  return (
    <form
      className="flex flex-col items-start gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!PHONE.test(phone)) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        request.mutate(phone);
      }}
    >
      <Field
        label="Telefone"
        help="Com código do país e DDD, só números. Ex.: 5511999990000."
        error={invalid ? 'Use de 8 a 15 dígitos, sem espaço nem símbolo.' : undefined}
      >
        {(props) => (
          <input
            {...props}
            className={inputClass}
            inputMode="numeric"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        )}
      </Field>
      <Button type="submit" variant="primary" disabled={request.isPending}>
        Gerar código
      </Button>
      {request.isError && <ErrorNotice error={request.error} />}
      {code !== undefined && (
        <div role="status" className="flex flex-col gap-1">
          <p className="text-muted">Digite no WhatsApp, em Aparelhos conectados:</p>
          <p className="font-mono text-title tracking-widest">{code}</p>
        </div>
      )}
    </form>
  );
}

function Pairing({
  qr,
  code,
  canManage,
  onCode,
}: {
  qr: Qr | undefined;
  code: string | undefined;
  canManage: boolean;
  onCode: (code: string) => void;
}) {
  return (
    <div className="grid items-start gap-6 md:grid-cols-2">
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-section font-semibold">QR code</h2>
        {qr ? (
          <QrCode value={qr.qr} />
        ) : (
          <p role="status" className="text-muted">
            Aguardando o QR. Ele aparece aqui assim que o bot gerar.
          </p>
        )}
        {qr?.expiresAt !== undefined && (
          <p className="text-help text-muted">
            Vale até {new Date(qr.expiresAt).toLocaleTimeString('pt-BR')}; o próximo troca sozinho.
          </p>
        )}
      </section>
      {canManage && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-section font-semibold">Código de pareamento</h2>
          <PairingCode code={code} onCode={onCode} />
        </section>
      )}
    </div>
  );
}

/** Conexão do WhatsApp: estado, conta, pareamento (QR ou código) e desvínculo, ao vivo. */
export function Connection() {
  const client = useQueryClient();
  const { can } = useSession();
  const query = useConnection();
  const canManage = can('connection.manage');
  const [qr, setQr] = useState<Qr>();
  const [code, setCode] = useState<string>();

  useLiveEvent('connection.qr', (data) => {
    if (isQr(data)) setQr({ qr: data.qr, expiresAt: data.expiresAt });
  });
  useLiveEvent('connection.pairing-code', (data) => {
    const next = codeOf(data);
    if (next !== undefined) setCode(next);
  });
  useLiveEvent('connection.status', () => {
    void client.invalidateQueries({ queryKey: KEY });
  });

  const status = query.data?.status;
  // Conectado, QR e código não servem mais.
  useEffect(() => {
    if (status !== 'open') return;
    setQr(undefined);
    setCode(undefined);
  }, [status]);

  // O QR vence no horário que o bot informa; mostrar um vencido faz a pessoa escanear à toa.
  const expiresAt = qr?.expiresAt;
  useEffect(() => {
    if (expiresAt === undefined) return;
    const timer = setTimeout(() => setQr(undefined), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);

  return (
    <section className="flex flex-col gap-6">
      <PageTitle>Conexão</PageTitle>
      <Remote query={query}>
        {(connection) => {
          const { tone, word } = STATUS[connection.status];
          return (
            <Card className="flex flex-col gap-6">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-display text-section font-semibold">WhatsApp</span>
                <StateWord tone={tone}>{word}</StateWord>
                {connection.status !== 'open' && connection.reason && (
                  <span className="font-mono text-label text-muted">{connection.reason}</span>
                )}
              </p>
              {connection.status === 'open' ? (
                <>
                  <Account connection={connection} />
                  {canManage && <Logout />}
                </>
              ) : (
                <Pairing qr={qr} code={code} canManage={canManage} onCode={setCode} />
              )}
            </Card>
          );
        }}
      </Remote>
    </section>
  );
}
