import { it } from 'vitest';
import { makeCases } from './reports-helpers';
import { powertrainReport } from '../src/reports/powertrain';
import { cvtReport } from '../src/reports/cvt';
it('probe', () => {
  const out: string[] = [];
  for (const c of makeCases()) {
    const N = c.N, r = powertrainReport(N, 0, N.S.t.length - 1);
    const cv = cvtReport(N, 0, N.S.t.length - 1);
    out.push([c.label, 'laps', N.laps.length, 'ok', r.ok, 'launch', r.launchList.length, 'coasts', r.coast?.coasts.length, 'fit', !!r.coast?.fit, 'slip', !r.slip?.empty, 'cvt', cv.ok, cv.fit?.ok, cv.modelMsg].join(' '));
  }
  throw new Error(out.join('\n'));
});
