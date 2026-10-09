// #273 (ADR 0061): a árvore neutra do core na marcação do WhatsApp.

import { bold, code, fmt, italic, link, mention } from '@zapforge/core';
import { describe, expect, it } from 'vitest';
import { renderWhatsApp } from './format.ts';

const ALICE = { id: '5511911110000@s.whatsapp.net', name: 'Alice', phone: '5511911110000' };
const BOB_LID = { id: '222222222222222@lid', name: 'Bob', phone: null };

describe('renderWhatsApp', () => {
  it('traduz negrito, itálico e código', () => {
    expect(renderWhatsApp(fmt`${bold('a')} ${italic('b')} ${code('c()')}`)).toEqual({
      text: '*a* _b_ `c()`',
      mentions: [],
    });
  });

  it('aninha estilos', () => {
    expect(renderWhatsApp(bold('a ', italic('b'))).text).toBe('*a _b_*');
  });

  it('deixa o espaço das pontas fora do marcador, onde o WhatsApp o exige', () => {
    expect(renderWhatsApp(fmt`x${bold(' a ')}y`).text).toBe('x *a* y');
    expect(renderWhatsApp(bold('   ')).text).toBe('   ');
  });

  it('link mostra a URL, com o rótulo antes quando há', () => {
    expect(renderWhatsApp(link('https://ex.com')).text).toBe('https://ex.com');
    expect(renderWhatsApp(link('https://ex.com', 'site')).text).toBe('site (https://ex.com)');
  });

  it('menção vira @usuário do JID, inclusive LID, e entra na lista sem repetir', () => {
    const rendered = renderWhatsApp(
      fmt`${mention(ALICE)} e ${mention(BOB_LID)} e ${mention(ALICE)}`,
    );
    expect(rendered).toEqual({
      text: '@5511911110000 e @222222222222222 e @5511911110000',
      mentions: [ALICE.id, BOB_LID.id],
    });
  });

  it('texto literal vai como está', () => {
    expect(renderWhatsApp(fmt`${'2*3*4'}`).text).toBe('2*3*4');
  });
});
