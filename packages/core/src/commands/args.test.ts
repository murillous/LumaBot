import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.ts';

describe('parseArgs', () => {
  it('quebra por qualquer espaço em branco, ignorando repetições', () => {
    expect(parseArgs('  a   b\tc\nd  ')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('retorna lista vazia para texto vazio ou só com espaços', () => {
    expect(parseArgs('')).toEqual([]);
    expect(parseArgs('   ')).toEqual([]);
  });

  it('junta trecho entre aspas num argumento só, sem as aspas', () => {
    expect(parseArgs('criar "Luma séria" agora')).toEqual(['criar', 'Luma séria', 'agora']);
  });

  it('aceita aspas tipográficas do teclado do celular', () => {
    expect(parseArgs('criar “Luma séria”')).toEqual(['criar', 'Luma séria']);
  });

  it('cola aspas no meio da palavra ao mesmo argumento', () => {
    expect(parseArgs('nome="a b" x')).toEqual(['nome=a b', 'x']);
  });

  it('mantém argumento vazio vindo de aspas vazias', () => {
    expect(parseArgs('a "" b')).toEqual(['a', '', 'b']);
  });

  it('estende aspa sem fechamento até o fim do texto', () => {
    expect(parseArgs('a "b c')).toEqual(['a', 'b c']);
  });

  it('não trata apóstrofo como aspa', () => {
    expect(parseArgs("copo d'água cheio")).toEqual(['copo', "d'água", 'cheio']);
  });
});
