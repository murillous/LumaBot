// URL do Postgres dos testes de integração (`ZAPFORGE_TEST_POSTGRES_URL`). Sem ela, os testes
// do banco são pulados localmente; no CI ela é obrigatória, para a suíte não passar sem rodar.

const url = process.env['ZAPFORGE_TEST_POSTGRES_URL'];

if (url === undefined && process.env['CI'] === 'true') {
  throw new Error(
    'ZAPFORGE_TEST_POSTGRES_URL não definida: o CI roda os testes contra o Postgres.',
  );
}

/** URL do banco de testes, ou `undefined` para pular os testes que precisam dele. */
export const TEST_POSTGRES_URL: string | undefined = url;
