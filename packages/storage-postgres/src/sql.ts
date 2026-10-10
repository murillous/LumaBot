// Tradução da consulta canônica do core (`normalizeQuery`/`normalizeWhere`) para SQL sobre a
// coluna `doc` (jsonb). O nome de campo já chega validado como identificador simples, então vai
// interpolado na expressão; valores sempre entram como parâmetro.
//
// Cada campo vira um `jsonb` que nunca é NULL: o ausente vira o `null` do JSON, que é o que o
// contrato manda (campo ausente vale `null`). Assim a igualdade do `jsonb` já compara tipo e
// valor (`1`, `"1"` e `true` são diferentes) e nunca dá NULL, e o `ne` é o `NOT` exato do `eq`.

import type { Scalar } from '@zapforge/core';
import type { NormalizedCondition, NormalizedSort } from '@zapforge/core/adapter';

/** Parâmetros da consulta, na ordem dos `$n`; cada fragmento acrescenta os seus. */
export type SqlParams = unknown[];

/** Acrescenta `value` aos parâmetros e devolve o `$n` dele. */
export function bind(params: SqlParams, value: unknown): string {
  return `$${params.push(value)}`;
}

/** Expressão de um campo do documento. O índice declarado usa exatamente esta expressão. */
export function fieldValueSql(field: string): string {
  return `COALESCE(doc->'${field}', 'null'::jsonb)`;
}

interface FieldSql {
  /** O campo como `jsonb`, nunca NULL. */
  readonly json: string;
  /** O campo como texto, para comparar strings pela collation "C" (code point). */
  readonly text: string;
}

function fieldSql(field: string): FieldSql {
  // O `id` é coluna, sempre texto.
  if (field === 'id') return { json: 'to_jsonb(id)', text: 'id' };
  return { json: fieldValueSql(field), text: `(doc->>'${field}')` };
}

const COMPARISON = { gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;

function equals(field: FieldSql, operand: Scalar, params: SqlParams): string {
  return `${field.json} = ${bind(params, JSON.stringify(operand))}::jsonb`;
}

function condition(entry: NormalizedCondition, params: SqlParams): string {
  const field = fieldSql(entry.field);
  switch (entry.op) {
    case 'eq':
      return equals(field, entry.value, params);
    case 'ne':
      return `NOT (${equals(field, entry.value, params)})`;
    case 'in':
      // A lista vai como um array JSON num parâmetro só: `[]` não casa com nada, e lista longa
      // não esbarra no limite de parâmetros.
      return `${field.json} IN (SELECT jsonb_array_elements(${bind(params, JSON.stringify(entry.value))}::jsonb))`;
    default: {
      // Só casa com o mesmo tipo do operando. Número compara pelo `jsonb` (numérico); texto, pela
      // collation "C", que num banco UTF-8 é a ordem de code point do contrato.
      const op = COMPARISON[entry.op];
      if (typeof entry.value === 'number') {
        return `(jsonb_typeof(${field.json}) = 'number' AND ${field.json} ${op} ${bind(params, JSON.stringify(entry.value))}::jsonb)`;
      }
      return `(jsonb_typeof(${field.json}) = 'string' AND ${field.text} COLLATE "C" ${op} ${bind(params, entry.value)}::text)`;
    }
  }
}

/** Condições combinadas com E; lista vazia casa com tudo. */
export function whereSql(conditions: readonly NormalizedCondition[], params: SqlParams): string {
  if (conditions.length === 0) return 'true';
  return conditions.map((entry) => condition(entry, params)).join(' AND ');
}

/**
 * Ordenação do contrato: primeiro a classe de tipo (null/ausente < booleano < número < texto <
 * array/objeto), depois o valor (arrays e objetos empatam), e o empate cai no `seq` — sempre
 * crescente, também em `desc`. Dentro de uma classe, as chaves de valor das outras são NULL em
 * todas as linhas, então a posição do NULL não interfere.
 */
export function orderBySql(sorts: readonly NormalizedSort[]): string {
  const terms = sorts.flatMap(({ field, direction }) => {
    const { json, text } = fieldSql(field);
    const dir = direction === 'asc' ? 'ASC' : 'DESC';
    const type = `jsonb_typeof(${json})`;
    const rank =
      `CASE ${type} WHEN 'null' THEN 0 WHEN 'boolean' THEN 1 WHEN 'number' THEN 2 ` +
      `WHEN 'string' THEN 3 ELSE 4 END`;
    const scalar = `CASE WHEN ${type} IN ('boolean', 'number') THEN ${json} END`;
    const string = `CASE WHEN ${type} = 'string' THEN ${text} COLLATE "C" END`;
    return [`${rank} ${dir}`, `${scalar} ${dir}`, `${string} ${dir}`];
  });
  return [...terms, 'seq ASC'].join(', ');
}
