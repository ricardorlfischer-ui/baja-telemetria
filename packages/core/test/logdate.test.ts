/* Data do teste pelo nome do arquivo da FT e pelo cabeçalho do BUSMASTER (logdate.ts). */
import { describe, it, expect } from 'vitest';
import { readFixture } from './legacy';
import { guessDate } from '../src/logdate';

describe('guessDate', () => {
  it('nome do arquivo da FT (data e hora)', () => {
    expect(guessDate('Log 3_20261005-1644.csv')).toBe('2026-10-05T16:44');
    expect(guessDate('C:\\logs\\Log 12_20250131-0905.csv')).toBe('2025-01-31T09:05');
    expect(guessDate('/home/equipe/Log 1_20240229_2359.csv')).toBe('2024-02-29T23:59');
    /* exportação de um trecho: vale a primeira data/hora */
    expect(guessDate('Log 3_20261005-1648_20261005-1651.csv')).toBe('2026-10-05T16:48');
  });
  it('cabeçalho do BUSMASTER (dia:mês:ano)', () => {
    expect(guessDate('x.log', '***START DATE AND TIME 5:10:2026 16:34:30:698***')).toBe('2026-10-05T16:34');
    expect(guessDate('BUSMASTERLogFile_0.log (14).txt', '***BUSMASTER Ver 3.2.2***\n***START DATE AND TIME 31:1:2025 9:05:00:000***')).toBe('2025-01-31T09:05');
    const bm = readFixture('busmaster_14.log')!;
    expect(guessDate('busmaster_14.log', bm)).toBe('2026-10-05T16:34');
    /* o nome com data e hora ganha do cabeçalho */
    expect(guessDate('Log 3_20261005-1644.csv', '***START DATE AND TIME 5:10:2026 16:34:30:698***')).toBe('2026-10-05T16:44');
    /* só o começo do texto é lido */
    expect(guessDate('x.log', ' '.repeat(2100) + '***START DATE AND TIME 5:10:2026 16:34:30:698***')).toBeNull();
  });
  it('data solta no nome', () => {
    expect(guessDate('teste 2026-03-02.csv')).toBe('2026-03-02');
    expect(guessDate('enduro_20260302.csv')).toBe('2026-03-02');
  });
  it('sem data ou data impossível → null', () => {
    expect(guessDate('Log 3.csv')).toBeNull();
    expect(guessDate('Log_20261399-9999.csv')).toBeNull();
    expect(guessDate('x.log', '***START DATE AND TIME 32:13:2026 25:00:00:000***')).toBeNull();
    expect(guessDate('teste 1999-03-02.csv')).toBeNull();
    expect(guessDate('ft_log3_gps.csv', readFixture('ft_log3_gps.csv')!)).toBeNull();
  });
});
