// Tradução da consulta canônica do core (`normalizeQuery`/`normalizeWhere`) para SQL sobre a
// coluna `doc` (JSON em texto). O nome de campo já chega validado como identificador simples,
// então vai interpolado no caminho JSON; valores sempre entram como parâmetro.
//
// Cada campo é um par: `value` (o que `json_extract` devolve) e `type` (o `json_type`). O tipo é
// necessário porque `json_extract` devolve `true` como 1 e arrays/objetos como texto: sem ele,
// `{ v: 1 }` casaria `true` e `{ v: '[1]' }` casaria um array. Toda comparação usa `IS`, que
// nunca dá NULL: assim o `ne` pode ser o `NOT` exato do `eq`, inclusive para campo ausente.

import type { Scalar } from '@zapforge/core';
import type { NormalizedCondition, NormalizedSort } from '@zapforge/core/adapter';

export type SqlParam = string | number;

export interface SqlFragment {
  readonly sql: string;
  readonly params: readonly SqlParam[];
}

interface FieldSql {
  readonly value: string;
  readonly type: string;
}

/** Expressão de um campo do documento. O índice declarado usa exatamente esta expressão. */
export function fieldValueSql(field: string): string {
  return `json_extract(doc, '$.${field}')`;
}

function fieldSql(field: string): FieldSql {
  // O `id` é coluna, sempre texto.
  if (field === 'id') return { value: 'id', type: "'text'" };
  return { value: fieldValueSql(field), type: `json_type(doc, '$.${field}')` };
}

const NUMBER = (type: string): string => `(${type} IS 'integer' OR ${type} IS 'real')`;

function equals({ value, type }: FieldSql, operand: Scalar): SqlFragment {
  // JSON null e campo ausente: `json_extract` devolve NULL nos dois casos (array/objeto não).
  if (operand === null) return { sql: `${value} IS NULL`, params: [] };
  if (typeof operand === 'boolean') return { sql: `${type} IS '${operand}'`, params: [] };
  if (typeof operand === 'number') {
    return { sql: `(${NUMBER(type)} AND ${value} IS ?)`, params: [operand] };
  }
  return { sql: `(${type} IS 'text' AND ${value} IS ?)`, params: [operand] };
}

const COMPARISON = { gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;

function condition(entry: NormalizedCondition): SqlFragment {
  const field = fieldSql(entry.field);
  switch (entry.op) {
    case 'eq':
      return equals(field, entry.value);
    case 'ne': {
      const eq = equals(field, entry.value);
      return { sql: `NOT ${eq.sql}`, params: eq.params };
    }
    case 'in': {
      if (entry.value.length === 0) return { sql: '0', params: [] };
      const items = entry.value.map((operand) => equals(field, operand));
      return {
        sql: `(${items.map((item) => item.sql).join(' OR ')})`,
        params: items.flatMap((item) => item.params),
      };
    }
    default: {
      // Só casa com o mesmo tipo do operando. Texto compara pela collation BINARY, que no banco
      // UTF-8 é a ordem de code point do contrato.
      const sameType =
        typeof entry.value === 'number' ? NUMBER(field.type) : `${field.type} IS 'text'`;
      return {
        sql: `(${sameType} AND ${field.value} ${COMPARISON[entry.op]} ?)`,
        params: [entry.value],
      };
    }
  }
}

/** Condições combinadas com E; lista vazia casa com tudo. */
export function whereSql(conditions: readonly NormalizedCondition[]): SqlFragment {
  if (conditions.length === 0) return { sql: '1', params: [] };
  const parts = conditions.map(condition);
  return {
    sql: parts.map((part) => part.sql).join(' AND '),
    params: parts.flatMap((part) => part.params),
  };
}

/**
 * Ordenação do contrato: primeiro a classe de tipo (null/ausente < booleano < número < texto <
 * array/objeto), depois o valor (arrays e objetos empatam), e o empate cai no `seq` — sempre
 * crescente, também em `desc`.
 */
export function orderBySql(sorts: readonly NormalizedSort[]): string {
  const terms = sorts.flatMap(({ field, direction }) => {
    const { value, type } = fieldSql(field);
    const dir = direction === 'asc' ? 'ASC' : 'DESC';
    const rank =
      `CASE WHEN ${value} IS NULL THEN 0 WHEN ${type} IN ('true', 'false') THEN 1 ` +
      `WHEN ${type} IN ('integer', 'real') THEN 2 WHEN ${type} IS 'text' THEN 3 ELSE 4 END`;
    const comparable = `CASE WHEN ${type} IN ('array', 'object') THEN NULL ELSE ${value} END`;
    return [`${rank} ${dir}`, `${comparable} ${dir}`];
  });
  return [...terms, 'seq ASC'].join(', ');
}
