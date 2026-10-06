import { describe, it, expect } from 'vitest';
import { loadLegacy, legacyDemo, legacyCompute, legacyAnalysis, readFixture } from './legacy';

describe('carregador do app antigo', () => {
  it('roda o exemplo inteiro e a ficha de projeto', () => {
    const L = loadLegacy({ ui: true });
    const A = legacyDemo(L.BT);
    expect(A.track.ok).toBe(true);
    expect(A.laps.length).toBeGreaterThanOrEqual(3);
    expect(A.all.length).toBeGreaterThan(20);
    const an = legacyAnalysis(L, A);
    an.renderDesign();
    expect(an.designRows.length).toBeGreaterThan(10);
    expect(L.el('dsTable').innerHTML).toContain('Frequência natural');
  });

  it('lê os logs reais', () => {
    const L = loadLegacy();
    for (const f of ['ft_log3_gps.csv', 'ft_log3_shocks_compact.csv', 'busmaster_14.log']) {
      const text = readFixture(f);
      expect(text, f).not.toBeNull();
      const S = L.BT.parseLog(text, f);
      const A = legacyCompute(L.BT, S, {}, { autoLine: true });
      expect(A.all.length, f).toBeGreaterThan(0);
    }
  });
});
