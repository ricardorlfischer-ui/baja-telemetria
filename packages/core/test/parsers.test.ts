/* Equivalência de parsers.ts com legacy/js/parsers.js: a Session inteira (name, kind, t,
 * canais com data/lo/hi/count/constant, gps, clock0, info) tem que ser igual. */
import { describe, it, expect } from 'vitest';
import { loadLegacy, readFixture } from './legacy';
import { same } from './compare';
import { parseLog, parseCSV, parseBusmaster, prettyName, finishChannel } from '../src/parsers';
import { demoCSV } from '../src/demo';

const { BT } = loadLegacy();

/* roda os dois; se o antigo lança erro, o novo tem que lançar a mesma mensagem */
function check(fnOld: (t: string, n: string) => unknown, fnNew: (t: string, n: string) => unknown, text: string, name: string) {
  let a: unknown, errA: string | null = null;
  try { a = fnOld(text, name); } catch (e) { errA = (e as Error).message; }
  if (errA !== null) {
    expect(() => fnNew(text, name), name).toThrow(errA);
    let msg = '';
    try { fnNew(text, name); } catch (e) { msg = (e as Error).message; }
    expect(msg, name).toBe(errA);
    return null;
  }
  const b = fnNew(text, name);
  expect(same(a, b), name).toEqual([]);
  return b;
}

const FILES = ['ft_log3_gps.csv', 'ft_log3_shocks_compact.csv', 'busmaster_14.log'];
const SAMPLES = ['Log 3_20261005-1648_20261005-1651.csv', 'Log 3_20261005-1644.csv', 'BUSMASTERLogFile_0.log (14).txt'];

describe('parsers: arquivos reais', () => {
  for (const f of FILES) {
    it(f, () => {
      const text = readFixture(f);
      expect(text, f).not.toBeNull();
      const S = check(BT.parseLog, parseLog, text!, f) as any;
      expect(S.channels.length).toBeGreaterThan(0);
      if (f.endsWith('.csv')) check(BT.parseCSV, parseCSV, text!, f);
      else check(BT.parseBusmaster, parseBusmaster, text!, f);
    });
  }
  for (const f of SAMPLES) {
    const text = readFixture(f);
    it.skipIf(text === null)(`samples/${f}`, () => {
      check(BT.parseLog, parseLog, text!, f);
    });
  }
  it('sessão de exemplo (demoCSV)', () => {
    const text = BT.demoCSV();
    const S = check(BT.parseCSV, parseCSV, text, 'exemplo_baja.csv') as any;
    expect(S.channels.length).toBe(12);
    check(BT.parseLog, parseLog, demoCSV(), 'exemplo_baja.csv');
  });
});

describe('parsers: casos sintéticos', () => {
  const big = '1797693134862320000000000000000000000000000000000000000000000000.000';
  const CSV: [string, string][] = [
    ['vazio', ''],
    ['só linhas em branco', '\n\n   \n\r\n'],
    ['uma coluna', 'abc\n1\n2\n'],
    ['só cabeçalho', 'TIME,A,B\n'],
    ['ponto e vírgula + vírgula decimal', 'TIME;Velocidade;Temp\n0,00;1,5;20\n0,04;1,6;\n0,08;;21,25\n'],
    ['tab + vírgula decimal', 'Tempo\tA\tB\n0,0\t1,5\t2\n0,5\t-3,25\t4\n'],
    ['linha de unidades', 'TIME,Speed,Temp\n(s),(km/h),°C\n0,1,2\n0.04,1.5,2.5\n0.08,2,3\n'],
    ['linha de unidades com aspas', '"TIME","Speed","Temp"\n"s","km/h",""\n"0.0","1.2","3"\n"0.04","1.3","4"\n'],
    ['linha de unidades vazia (não conta)', 'TIME,A\n,\n0,1\n1,2\n'],
    ['colunas vazias e linhas curtas', 'TIME,A,B,C\n0,,,\n0.04,1,,\n0.08,,2\n0.12\n0.16,3,4,5,6\n0.2,,,\n'],
    ['CRLF e linhas em branco no começo', '\r\n\r\nTIME,Shock_-_Front_Left,Shock_velocity_FL\r\n0,10.5,3\r\n0.04,10.6,-2\r\n\r\n0.08,10.7,1\r\n'],
    ['DBL_MAX por extenso', `TIME,A,B\n-1,${big},${big}\n0,1,${big}\n0.04,2,3\n0.08,${big},${big}\n`],
    ['valores gigantes viram NaN', 'TIME,A\n0,1e301\n1,2\n2,-1e300\n3,1e299\n'],
    ['sem nenhum dado além do tempo', 'TIME,A,B\n0,,\n1,,\n2,,\n'],
    ['tempo inválido em tudo', 'TIME,A\nx,1\ny,2\n'],
    ['tempo não é a primeira coluna', 'A,time (s),B\n1,0,2\n3,0.5,4\n5,1,\n'],
    ['coluna t', 'X,t\n1,0\n2,1\n'],
    ['uma linha só', 'TIME,A\n5,1\n'],
    ['canal constante', 'TIME,A,B\n0,1,1\n1,1,2\n2,1,3\n'],
    ['nomes com _-_ e espaços', 'TIME, Shock_-_Rear__Right ,"O2_General"\n0,1,2\n1,2,3\n'],
    ['aspas nos números com ;', 'TIME;A\n"0,5";"1,25"\n"1,0";"2,5"\n'],
    ['mais vírgulas que ponto e vírgula no cabeçalho', 'a,b;c,d\n1,2;3,4\n'],
  ];
  for (const [label, text] of CSV) {
    it(`CSV: ${label}`, () => {
      check(BT.parseCSV, parseCSV, text, label + '.csv');
      check(BT.parseLog, parseLog, text, label + '.csv');
    });
  }

  const id = (prod: number, dtype: number, msg: number) => '0x' + ((prod * 2 ** 14) + (dtype << 11) + msg).toString(16).toUpperCase();
  const EXP = id(0x47E0, 2, 0x2FF), OTH = id(0x1234, 3, 0x0FF), LOW = id(0x47E0, 1, 0x2FF), BADMSG = id(0x47E0, 2, 0x200);
  const HEAD = '***BUSMASTER Ver 3.2.2***\n***PROTOCOL CAN***\n***HEX***\n***<Time><Tx/Rx><Channel><CAN ID><Type><DLC><DataBytes>***\n';
  const BUS = HEAD + [
    '23:59:58:0000 Rx 18 0x100A001 xr 0 ',
    '23:59:58:5000 Rx 1 0x023 s 8 0C D3 07 00 00 00 00 00',
    '23:59:59:0000 Rx 1 0x023 s 8 1F D3 00 00 00 03 01 00',
    '23:59:59:1000 Rx 1 0x028 s 5 00 10 20 30 E4',
    '23:59:59:1200 Rx 1 0x028 s 5 01 11 22 33 F2',
    '23:59:59:3500 Rx 1 0x028 s 5 00 14 20 30 E4',
    '23:59:59:3600 Rx 1 0x028 s 5 01 15 22 33 F2',
    '23:59:59:5000 Rx 1 0x7E9 s 4 FF 80 81 03',
    `23:59:59:6000 Rx 1 ${EXP} x 8 FF 00 EE 01 23 00 4E FF`,
    `23:59:59:7000 Rx 1 ${EXP} x 8 00 00 0C 01 77 00 10 00`,
    `23:59:59:7100 Rx 1 ${EXP} x 8 01 4E FF FE 00 27 00 05`,
    `23:59:59:7200 Rx 1 ${EXP} x 5 02 00 00 00 01`,
    `23:59:59:8000 Rx 1 ${EXP} x 8 00 00 08 00 02 00 01 00`,
    `23:59:59:8100 Rx 1 ${EXP} x 8 03 00 00 00 00 00 00 00`,
    `23:59:59:9000 Rx 1 ${OTH} x 8 FF 00 02 80 00 12 34 00`,
    `23:59:59:9100 Rx 1 ${LOW} x 8 FF 00 02 00 01 00 00 00`,
    `23:59:59:9200 Rx 1 ${BADMSG} x 8 FF 00 02 00 01 00 00 00`,
    '00:00:00:1000 Rx 1 0x023 s 8 1F D3 00 00 00 04 00 00',
    '00:00:00:2000 Rx 1 0x028 s 5 00 18 20 30 E4',
    '00:00:00:2100 Rx 1 0x028 s 5 01 19 22 33 F2',
    '00:00:00:3000 Rx 1 0x023 s 8 1F D3 00 00 00 03 01 00',
    '00:00:00:3100 Rx 1 0x028 s 5 01 19 22 33 F2',
    '00:00:00:4000 Tx 1 0x028 s 5 00 1C 20 30 E4',
    '00:00:00:4500 Rx 1 0x028 s 5 01 1D 22 33 F2',
    '00:00:03:0000 Rx 1 0x028 s 5 00 20 20 30 E4',
    '00:00:03:1000 Rx 1 0x028 s 5 01 21 22 33 F2',
    '00:00:04:0000 Rx 1 0x7E9 s 3 01 02 03',
    'linha que não é quadro',
  ].join('\n') + '\n';
  const DEC = '***BUSMASTER Ver 3.2.2***\n***DEC***\n' + [
    '10:00:00:0000 Rx 1 35 s 8 31 211 0 0 0 3 1 0',
    '10:00:00:1000 Rx 1 40 s 5 0 16 32 48 228',
    '10:00:00:2000 Rx 1 40 s 5 1 17 34 51 242',
    '10:00:01:0000 Rx 1 2025 s 4 254 120 130 3',
  ].join('\n');
  const BUSCASES: [string, string][] = [
    ['meia-noite, montagem FTCAN, fix', BUS],
    ['decimal', DEC],
    ['sem quadros', HEAD + 'nada aqui\n'],
    ['cabeçalho <Time><Tx/Rx> sem ***BUSMASTER', '***<Time><Tx/Rx><Channel><CAN ID><Type><DLC><DataBytes>***\n10:00:00:0000 Rx 1 0x7E9 s 4 01 02 03 04\n'],
    ['um quadro só', HEAD + '10:00:00:0000 Rx 1 0x7E9 s 4 01 02 03 04\n'],
  ];
  for (const [label, text] of BUSCASES) {
    it(`BUSMASTER: ${label}`, () => {
      check(BT.parseLog, parseLog, text, label + '.log');
      check(BT.parseBusmaster, parseBusmaster, text, label + '.log');
    });
  }

  it('prettyName e finishChannel', () => {
    for (const s of ['Shock_-_Front_Left', 'a__b', '  x  y ', '_-_', 'GPS · latitude', ''])
      expect(prettyName(s)).toBe(BT.prettyName(s));
    for (const a of [[], [NaN], [1, 1, 1], [1, 1 + 1e-10], [1, 2, NaN, -3]]) {
      const mk = () => ({ key: 'k', name: 'n', unit: 'u', data: Float64Array.from(a), src: 'log' as const });
      expect(same(BT.finishChannel(mk()), finishChannel(mk()))).toEqual([]);
    }
  });
});
