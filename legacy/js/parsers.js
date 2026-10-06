/* Leitura dos logs.
 *
 * Sessão (resultado de qualquer parser):
 *   { name, kind: 'FT' | 'BUSMASTER', t: Float64Array (s),
 *     channels: [{ key, name, unit, data: Float64Array, src: 'log', lo, hi, constant }],
 *     gps?: { lat: Float64Array, lon: Float64Array }   (só BUSMASTER: posição real do módulo)
 *     info: texto curto para o cabeçalho }
 */
'use strict';

BT.parseLog = (text, name) => {
  const head = text.slice(0, 4000);
  if (/\*\*\*BUSMASTER/.test(head) || head.includes('<Time><Tx/Rx>')) return BT.parseBusmaster(text, name);
  return BT.parseCSV(text, name);
};

/* "Shock_-_Front_Left" -> "Shock - Front Left" */
BT.prettyName = s => s.replace(/_-_/g, ' - ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

BT.finishChannel = ch => {
  const r = BT.range(ch.data);
  ch.lo = r.lo; ch.hi = r.hi; ch.count = r.n;
  ch.constant = r.n === 0 || r.hi - r.lo < 1e-9;
  return ch;
};

/* ---------------------------------------------------------------- FT Manager CSV
 * Primeira linha = nomes dos canais, primeira coluna (ou TIME) = tempo em s.
 * A FT grava 1.797e308 (DBL_MAX, escrito por extenso com ~310 dígitos) quando o canal
 * não tem dado; isso vira NaN. Linhas sem nenhum dado no começo/fim são cortadas. */
BT.parseCSV = (text, name) => {
  const lines = text.split(/\r?\n/);
  let s0 = 0;
  while (s0 < lines.length && !lines[s0].trim()) s0++;
  if (s0 >= lines.length) throw new Error('Arquivo vazio');
  const head = lines[s0];
  const delim = [',', ';', '\t'].map(d => [head.split(d).length, d]).sort((a, b) => b[0] - a[0])[0][1];
  const cols = head.split(delim).map(s => s.trim().replace(/^"|"$/g, ''));
  const nc = cols.length;
  if (nc < 2) throw new Error('Não parece um CSV (uma coluna só)');
  const commaDec = delim !== ',';
  const num = s => {
    if (s === undefined) return NaN;
    if (s.length > 40) return NaN;                       /* DBL_MAX por extenso = sem dado */
    s = s.trim();
    if (s.charCodeAt(0) === 34) s = s.replace(/"/g, '');
    if (commaDec) s = s.replace(',', '.');
    const v = parseFloat(s);
    return isFinite(v) && Math.abs(v) < 1e300 ? v : NaN;
  };

  /* segunda linha pode ser de unidades */
  let units = new Array(nc).fill('');
  let d0 = s0 + 1;
  if (d0 < lines.length) {
    const p = lines[d0].split(delim);
    if (p.length === nc && p.every(x => !isFinite(num(x)) && x.length < 40) && p.some(x => x.trim())) {
      units = p.map(x => x.trim().replace(/^"|"$/g, '').replace(/^\(|\)$/g, ''));
      d0++;
    }
  }

  const rows = [];
  for (let i = d0; i < lines.length; i++) {
    const l = lines[i];
    if (!l || !l.trim()) continue;
    rows.push(l.split(delim));
  }
  let ti = cols.findIndex(c => /^(time|tempo|t|time ?\(s\)|tempo ?\(s\))$/i.test(c));
  if (ti < 0) ti = 0;

  const n = rows.length;
  const T = new Float64Array(n);
  const C = cols.map(() => new Float64Array(n));
  for (let r = 0; r < n; r++) {
    const p = rows[r];
    for (let c = 0; c < nc; c++) C[c][r] = num(p[c]);
  }
  T.set(C[ti]);

  /* corta o começo/fim sem dado (a FT exporta uma janela antes do início do log) */
  let a = 0, b = n - 1;
  const hasData = r => { if (!isFinite(T[r])) return false; for (let c = 0; c < nc; c++) if (c !== ti && C[c][r] === C[c][r]) return true; return false; };
  while (a <= b && !hasData(a)) a++;
  while (b >= a && !hasData(b)) b--;
  if (a > b) { a = 0; b = n - 1; while (a <= b && !isFinite(T[a])) a++; while (b >= a && !isFinite(T[b])) b--; }
  if (a > b) throw new Error('Nenhuma linha com tempo válido');

  const t = T.slice(a, b + 1);
  const channels = [];
  cols.forEach((c, i) => {
    if (i === ti) return;
    channels.push(BT.finishChannel({ key: c, name: BT.prettyName(c), unit: units[i] || '', data: C[i].slice(a, b + 1), src: 'log' }));
  });
  const dt = t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : 0;
  return {
    name, kind: 'FT', t, channels,
    info: `${t.length} amostras · ${channels.length} canais · ${dt ? Math.round(1 / dt) + ' Hz' : ''}` +
      (a > 0 || b < n - 1 ? ` · ${n - t.length} linhas sem dado cortadas` : '')
  };
};

/* ---------------------------------------------------------------- BUSMASTER (.log/.txt)
 * Linha: "16:34:36:1290 Rx 1 0x028 s 5 00 00 00 00 00"  (tempo em 1/10000 s)
 * Decodifica (ver pic_gps_expander):
 *   0x028 std mux 00/01  longitude/latitude int32 LE, 1e-7 grau
 *   0x023 std "1F D3 00 .."  byte 5 = gpsFix, byte 6 = flags (bit0 fixOK)
 *   0x023 std "0C D3 nn .."  byte 2 = satélites (provável)
 *   0x7E9 std (debug do PIC) status, X, Y, fixType
 *   FTCAN 2.0 (ext) msgs 0x0FF..0x3FF tipo 2/3: pares DataID/valor (int16) de cada produto
 * Tudo é reamostrado numa grade de 20 Hz (segura o último valor); lat/lon interpolados. */
BT.parseBusmaster = (text, name) => {
  const lines = text.split(/\r?\n/);
  const hex = !/\*\*\*DEC\*\*\*/.test(text.slice(0, 3000));
  const base = hex ? 16 : 10;
  const re = /^(\d+):(\d+):(\d+):(\d+)\s+(?:Rx|Tx)\s+\d+\s+(0x[0-9A-Fa-f]+|\d+)\s+([a-z]+)\s+(\d+)\s*(.*)$/;
  const ser = new Map();
  const push = (k, t, v, unit) => {
    let s = ser.get(k);
    if (!s) ser.set(k, s = { t: [], v: [], unit: unit || '' });
    s.t.push(t); s.v.push(v);
  };
  const pos = [];
  const asm = new Map();
  let lon = null, fix = 0, flags = 0, tSol = -1e9, tPrev = -1, dayOff = 0, t0 = null, clock0 = '', frames = 0;

  for (const l of lines) {
    const m = re.exec(l);
    if (!m) continue;
    let t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 10000 + dayOff;
    if (tPrev >= 0 && t < tPrev - 43200) { dayOff += 86400; t += 86400; }  /* virou a meia-noite */
    tPrev = t;
    if (t0 === null) { t0 = t; clock0 = `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}:${m[3].padStart(2, '0')}`; }
    const tr = t - t0;
    const type = m[6];
    if (type.includes('r')) continue;                                   /* remote frame */
    const ext = type[0] === 'x';
    const id = parseInt(m[5], m[5].startsWith('0x') ? 16 : base);
    const d = m[8].trim() ? m[8].trim().split(/\s+/).map(x => parseInt(x, base)) : [];
    frames++;

    if (!ext) {
      if (id === 0x028 && d.length >= 5) {
        const v = d[1] | (d[2] << 8) | (d[3] << 16) | (d[4] << 24);      /* int32 com sinal */
        if (d[0] === 0x00) lon = v;
        else if (d[0] === 0x01) {
          if (lon !== null) {
            const ok = (fix === 3 || fix === 4) && (flags & 1) && tr - tSol < 1.0;
            pos.push({ t: tr, lat: v * 1e-7, lon: lon * 1e-7, ok });
            push('GPS · latitude', tr, ok ? v * 1e-7 : NaN, '°');
            push('GPS · longitude', tr, ok ? lon * 1e-7 : NaN, '°');
          }
          lon = null;
        }
      } else if (id === 0x023 && d.length === 8 && d[1] === 0xD3) {
        if (d[0] === 0x1F && d[2] === 0x00) { fix = d[5]; flags = d[6]; tSol = tr; push('GPS · tipo de fix', tr, fix); }
        else if (d[0] === 0x0C) push('GPS · satélites', tr, d[2]);
      } else if (id === 0x7E9 && d.length >= 4) {
        push('PIC · status GPS', tr, d[0]);
        push('PIC · X (código)', tr, d[1]);
        push('PIC · Y (código)', tr, d[2]);
      }
      continue;
    }

    /* FTCAN 2.0: produto[28:14] tipo[13:11] msg[10:0] */
    const dtype = (id >> 11) & 7, msg = id & 0x7FF, prod = id >>> 14;
    if (dtype < 2 || !d.length || (msg !== 0x0FF && msg !== 0x1FF && msg !== 0x2FF && msg !== 0x3FF)) continue;
    let pl = null;
    if (d[0] === 0xFF) pl = d.slice(1);
    else if (d[0] === 0x00 && d.length >= 3) {
      const a = { len: (d[1] << 8) | d[2], buf: d.slice(3), next: 1 };
      if (a.buf.length >= a.len) pl = a.buf.slice(0, a.len); else asm.set(id, a);
    } else {
      const a = asm.get(id);
      if (!a) continue;
      if (d[0] !== a.next) { asm.delete(id); continue; }               /* perdeu um pedaço */
      for (let i = 1; i < d.length; i++) a.buf.push(d[i]);
      a.next++;
      if (a.buf.length >= a.len) { pl = a.buf.slice(0, a.len); asm.delete(id); }
    }
    if (!pl) continue;
    const pname = prod === 0x47E0 ? 'Expander' : 'FT 0x' + prod.toString(16).toUpperCase();
    for (let i = 0; i + 3 < pl.length; i += 4) {
      const did = ((pl[i] << 8) | pl[i + 1]) >> 1;
      let v = (pl[i + 2] << 8) | pl[i + 3];
      if (v & 0x8000) v -= 0x10000;
      push(`${pname} · ID 0x${did.toString(16).toUpperCase().padStart(4, '0')}`, tr, v);
    }
  }
  if (t0 === null) throw new Error('Nenhum quadro CAN reconhecido no log do BUSMASTER');

  /* grade de 20 Hz */
  const dt = 0.05, tEnd = tPrev - t0;
  const n = Math.max(2, Math.floor(tEnd / dt) + 1);
  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = i * dt;

  const hold = s => {
    const out = new Float64Array(n).fill(NaN);
    let k = -1;
    for (let i = 0; i < n; i++) {
      while (k + 1 < s.t.length && s.t[k + 1] <= t[i] + 1e-9) k++;
      if (k >= 0) out[i] = s.v[k];
    }
    return out;
  };
  const channels = [];
  const order = k => (k.startsWith('GPS') ? 0 : k.startsWith('PIC') ? 1 : k.startsWith('Expander') ? 2 : 3) + k;
  [...ser.keys()].sort((a, b) => order(a) < order(b) ? -1 : 1).forEach(k => {
    const s = ser.get(k);
    channels.push(BT.finishChannel({ key: k, name: k, unit: s.unit, data: hold(s), src: 'log' }));
  });

  /* posição: interpola entre fixes válidos (4 Hz); buraco > 1,5 s fica sem posição */
  const lat = new Float64Array(n).fill(NaN), lonA = new Float64Array(n).fill(NaN);
  const P = pos.filter(p => p.ok);
  let k = 0;
  for (let i = 0; i < n && P.length; i++) {
    while (k + 1 < P.length && P[k + 1].t <= t[i]) k++;
    const p0 = P[k], p1 = P[k + 1];
    if (t[i] < p0.t) continue;
    if (p1 && p1.t - p0.t <= 1.5) {
      const u = (t[i] - p0.t) / (p1.t - p0.t);
      lat[i] = p0.lat + (p1.lat - p0.lat) * u; lonA[i] = p0.lon + (p1.lon - p0.lon) * u;
    } else if (t[i] - p0.t <= 0.5) { lat[i] = p0.lat; lonA[i] = p0.lon; }
  }
  const nFix = P.length;
  return {
    name, kind: 'BUSMASTER', t, channels, gps: { lat, lon: lonA }, clock0,
    info: `BUSMASTER · ${frames} quadros · início ${clock0} · ${pos.length} posições GPS (${nFix} com fix)`
  };
};
