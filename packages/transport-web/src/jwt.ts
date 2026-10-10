// Verificação do JWT do sistema do dono (ADR 0077). O `jose` cuida de assinatura, algoritmo, JWKS
// e prazos; aqui fica só a escolha da chave e o que o transport exige do payload.

import type { JsonValue } from '@zapforge/core';
import { createRemoteJWKSet, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';

interface AuthCommon {
  /** `iss` esperado. Ausente: não confere. */
  readonly issuer?: string;
  /** `aud` esperado. Ausente: não confere. */
  readonly audience?: string;
}

/** Como validar o token: segredo compartilhado (`HS256`) ou JWKS do sistema do dono. */
export type WebAuth =
  | (AuthCommon & { readonly secret: string; readonly jwksUrl?: never })
  | (AuthCommon & { readonly jwksUrl: string; readonly secret?: never });

/** Token aceito: o `sub`, o prazo e o payload inteiro, que vira `Contact.claims`. */
export interface VerifiedToken {
  readonly sub: string;
  /** `exp` em epoch de milissegundos. */
  readonly expiresAt: number;
  readonly claims: Readonly<Record<string, JsonValue>>;
}

export type TokenVerifier = (token: string) => Promise<VerifiedToken>;

/** Lançado para qualquer token recusado; a mensagem é do `jose` ou do transport. */
export class InvalidTokenError extends Error {
  override readonly name = 'InvalidTokenError';
}

// Lista fechada por tipo de chave: sem ela, um token `HS256` assinado com a chave pública do JWKS
// passaria (confusão de algoritmo).
const SECRET_ALGORITHMS = ['HS256'];
const JWKS_ALGORITHMS = ['RS256', 'ES256'];

/** Monta o verificador. Valida a config na hora: a fábrica a chama, e o erro vira `BotConfigError`. */
export function createVerifier(auth: WebAuth): TokenVerifier {
  let key: Uint8Array | JWTVerifyGetKey;
  let algorithms: string[];
  if (typeof auth.secret === 'string') {
    // Abaixo de 32 bytes, o HMAC-SHA256 fica abaixo da força do próprio hash (RFC 7518 §3.2).
    if (Buffer.byteLength(auth.secret) < 32) {
      throw new TypeError('web: auth.secret precisa de pelo menos 32 bytes');
    }
    key = new TextEncoder().encode(auth.secret);
    algorithms = SECRET_ALGORITHMS;
  } else if (typeof auth.jwksUrl === 'string') {
    // O `jose` busca o JWKS na primeira verificação, cacheia e busca de novo para um `kid` novo.
    key = createRemoteJWKSet(new URL(auth.jwksUrl));
    algorithms = JWKS_ALGORITHMS;
  } else {
    throw new TypeError('web: auth precisa de `secret` ou de `jwksUrl`');
  }
  const options = {
    algorithms,
    requiredClaims: ['exp', 'sub'],
    ...(auth.issuer === undefined ? null : { issuer: auth.issuer }),
    ...(auth.audience === undefined ? null : { audience: auth.audience }),
  };

  return async (token) => {
    let payload: JWTPayload;
    try {
      // As duas sobrecargas do `jose` (chave fixa e função de chave) não unem num só tipo.
      ({ payload } =
        key instanceof Uint8Array
          ? await jwtVerify(token, key, options)
          : await jwtVerify(token, key, options));
    } catch (error) {
      throw new InvalidTokenError(error instanceof Error ? error.message : String(error), {
        cause: error,
      });
    }
    // `requiredClaims` garante a presença; o tipo, não.
    if (typeof payload.sub !== 'string' || payload.sub === '' || typeof payload.exp !== 'number') {
      throw new InvalidTokenError('token sem `sub` em texto ou sem `exp` numérico');
    }
    return {
      sub: payload.sub,
      expiresAt: payload.exp * 1000,
      claims: payload as Readonly<Record<string, JsonValue>>,
    };
  };
}

/** Token do header `Authorization: Bearer <jwt>`, ou `null`. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  const match = header === null ? null : /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}
