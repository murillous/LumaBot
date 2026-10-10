// O verificador do JWT (ADR 0077): algoritmos por tipo de chave, claims obrigatórios e JWKS.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { bearerToken, createVerifier, InvalidTokenError } from './jwt.ts';

const SECRET = 'segredo-de-teste-com-pelo-menos-32-bytes';
const key = new TextEncoder().encode(SECRET);
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise((resolve) => server.close(resolve));
  }
});

function jwt(claims: Record<string, unknown> = {}): SignJWT {
  return new SignJWT(claims).setSubject('u1').setExpirationTime('1h');
}

describe('createVerifier', () => {
  it('com segredo, aceita HS256 e devolve sub, prazo em ms e o payload como claims', async () => {
    const verify = createVerifier({ secret: SECRET });
    const token = await jwt({ role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).sign(key);
    const verified = await verify(token);
    expect(verified.sub).toBe('u1');
    expect(verified.expiresAt).toBeGreaterThan(Date.now());
    expect(verified.expiresAt % 1000).toBe(0);
    expect(verified.claims).toMatchObject({ sub: 'u1', role: 'admin' });
  });

  it('recusa outro algoritmo de HMAC: a lista é fechada', async () => {
    const verify = createVerifier({ secret: SECRET });
    const token = await jwt().setProtectedHeader({ alg: 'HS512' }).sign(key);
    await expect(verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('confere `issuer` e `audience` quando configurados', async () => {
    const verify = createVerifier({ secret: SECRET, issuer: 'erp', audience: 'chat' });
    const sign = (iss: string, aud: string) =>
      jwt().setIssuer(iss).setAudience(aud).setProtectedHeader({ alg: 'HS256' }).sign(key);
    await expect(verify(await sign('erp', 'chat'))).resolves.toMatchObject({ sub: 'u1' });
    await expect(verify(await sign('outro', 'chat'))).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(verify(await sign('erp', 'outro'))).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('recusa token sem `exp`', async () => {
    const verify = createVerifier({ secret: SECRET });
    const token = await new SignJWT({})
      .setSubject('u1')
      .setProtectedHeader({ alg: 'HS256' })
      .sign(key);
    await expect(verify(token)).rejects.toThrow(/exp/);
  });

  it('config errada lança na hora', () => {
    expect(() => createVerifier({ secret: 'curto' })).toThrow(/32 bytes/);
    expect(() => createVerifier({} as never)).toThrow(/secret.*jwksUrl/);
  });

  it('com JWKS, busca a chave pelo `kid` e aceita RS256', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const verify = createVerifier({ jwksUrl: `http://127.0.0.1:${port}/jwks.json` });

    const token = await jwt().setProtectedHeader({ alg: 'RS256', kid: 'k1' }).sign(privateKey);
    await expect(verify(token)).resolves.toMatchObject({ sub: 'u1' });
    // HS256 assinado com qualquer coisa não passa pelo JWKS (confusão de algoritmo).
    const hmac = await jwt().setProtectedHeader({ alg: 'HS256', kid: 'k1' }).sign(key);
    await expect(verify(hmac)).rejects.toBeInstanceOf(InvalidTokenError);
  });
});

describe('bearerToken', () => {
  it('lê o token do header, ou devolve null', () => {
    const req = (authorization?: string) =>
      new Request('http://x', authorization === undefined ? {} : { headers: { authorization } });
    expect(bearerToken(req('Bearer abc.def.ghi'))).toBe('abc.def.ghi');
    expect(bearerToken(req('bearer abc'))).toBe('abc');
    expect(bearerToken(req('Basic abc'))).toBeNull();
    expect(bearerToken(req())).toBeNull();
  });
});
