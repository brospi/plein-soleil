import { describe, expect, it } from 'vitest';
import { cacheParArbres, calculerFaisceau, creerMasque, horizonPourAltitude, indiceAzimut } from '../src/coeur/horizon';
import { creerRaster } from '../src/coeur/raster';
import { boite, scene, X0, Y0, SOL } from './scenes';

const DEG = 180 / Math.PI;

describe('lancer de rayons', () => {
  it('mur de hauteur connue à distance connue', () => {
    // Mur de 20 m dont la face nord est à 30 m au sud de l'observateur.
    const { scene: s } = scene([boite('mur', -100, -50, 200, 20, 20)]);
    const f = calculerFaisceau(s.niveaux, X0 + 0.25, Y0 + 0.25, 180);
    const d = new Float32Array(f.nk);
    const a = creerMasque(f.nk);
    for (const z of [SOL, SOL + 10, SOL + 19]) {
      horizonPourAltitude(f, z, d, a);
      const plein = indiceAzimut(f, 180);
      const attendu = Math.atan((SOL + 20 - z) / 30.25) * DEG;
      expect(Math.abs(Math.atan(d[plein]) * DEG - attendu)).toBeLessThan(0.4);
      // À 45° du mur : la distance devient 30,25 / cos 45°.
      const oblique = indiceAzimut(f, 135);
      const attendu45 = Math.atan((SOL + 20 - z) / (30.25 / Math.SQRT1_2)) * DEG;
      expect(Math.abs(Math.atan(d[oblique]) * DEG - attendu45)).toBeLessThan(0.4);
    }
    // Au-dessus du mur : horizon dégagé.
    horizonPourAltitude(f, SOL + 25, d, a);
    expect(d[indiceAzimut(f, 180)]).toBeLessThan(0);
    // Aucun arbre dans la scène.
    expect(a.sommet[indiceAzimut(f, 180)]).toBe(-Infinity);
    expect(a.houppier[indiceAzimut(f, 180)]).toBe(Infinity);
  });

  it('l’enveloppe convexe donne le même horizon qu’un balayage exhaustif', () => {
    // Relief aléatoire reproductible.
    const r = creerRaster(X0 - 100, Y0 + 100, 0.5, 400, 400);
    let graine = 12345;
    const alea = () => ((graine = (graine * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let b = 0; b < 300; b++) {
      const c = Math.floor(alea() * 380);
      const l = Math.floor(alea() * 380);
      const h = alea() * 40;
      const w = 2 + Math.floor(alea() * 18);
      for (let i = l; i < l + w; i++) for (let j = c; j < c + w; j++) r.d[i * 400 + j] = Math.max(r.d[i * 400 + j], h);
    }
    const ox = X0 + 0.13;
    const oy = Y0 + 0.21;
    const f = calculerFaisceau([{ dur: r, arbres: null }], ox, oy, 0, { demiOuverture: 180, pasAz: 1 });
    const d = new Float32Array(f.nk);
    const a = creerMasque(f.nk);
    const co = Math.floor((ox - r.x0) / 0.5);
    const lo = Math.floor((r.y1 - oy) / 0.5);
    for (let k = 0; k < f.nk; k += 9) {
      const az = (k * Math.PI) / 180;
      const dx = Math.sin(az) || 1e-12;
      const dy = Math.cos(az) || 1e-12;
      // Référence indépendante : intersection du rayon avec chaque cellule (test des « dalles »).
      const entrees: Array<[number, number]> = [];
      for (let l = 0; l < 400; l++) {
        for (let c = 0; c < 400; c++) {
          if (l === lo && c === co) continue;
          const x0 = r.x0 + c * 0.5;
          const y1 = r.y1 - l * 0.5;
          const tx1 = (x0 - ox) / dx;
          const tx2 = (x0 + 0.5 - ox) / dx;
          const ty1 = (y1 - 0.5 - oy) / dy;
          const ty2 = (y1 - oy) / dy;
          const tMin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2));
          const tMax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2));
          if (tMax - tMin > 1e-7 && tMin > 0) entrees.push([tMin, r.d[l * 400 + c]]);
        }
      }
      for (const z of [0, 7.5, 21, 39]) {
        horizonPourAltitude(f, z, d, a);
        let m = -Infinity;
        for (const [t, h] of entrees) m = Math.max(m, (h - z - t * t * 6.83e-8) / t);
        expect(Math.abs(d[k] - m)).toBeLessThan(1e-3 * Math.max(1, Math.abs(m)));
      }
    }
  });

  it('passe d’un niveau fin à un niveau grossier', () => {
    const fin = creerRaster(X0 - 50, Y0 + 50, 0.5, 200, 200, 0);
    const grossier = creerRaster(X0 - 2000, Y0 + 2000, 8, 500, 500, 0);
    // Colline de 100 m à 1 km au nord, visible seulement dans le niveau grossier.
    for (let l = 0; l < 500; l++) for (let c = 0; c < 500; c++) if (l < 125) grossier.d[l * 500 + c] = 100;
    const f = calculerFaisceau([{ dur: fin, arbres: null }, { dur: grossier, arbres: null }], X0, Y0, 0);
    const d = new Float32Array(f.nk);
    horizonPourAltitude(f, 0, d, creerMasque(f.nk));
    const angle = Math.atan(d[indiceAzimut(f, 0)]) * DEG;
    expect(Math.abs(angle - Math.atan(100 / 1000) * DEG)).toBeLessThan(0.1);
  });

  it('houppier proche : le soleil passe sous les branches, pas à travers', () => {
    // Sol plat ; un arbre de 18 m dont le houppier commence à 6 m, de 10 à 14 m au sud.
    const sol = creerRaster(X0 - 100, Y0 + 100, 0.5, 400, 400, 0);
    const arbres = creerRaster(X0 - 100, Y0 + 100, 0.5, 400, 400, -9999);
    const bases = creerRaster(X0 - 100, Y0 + 100, 0.5, 400, 400, -9999);
    // Haie de 3 m pleine jusqu'au sol, à 70 m au sud (au-delà, tout compte jusqu'au sol).
    for (let l = 0; l < 400; l++) {
      for (let c = 0; c < 400; c++) {
        const x = sol.x0 + (c + 0.5) * 0.5 - X0;
        const y = sol.y1 - (l + 0.5) * 0.5 - Y0;
        if (Math.abs(x) < 20 && y < -10 && y > -14) {
          arbres.d[l * 400 + c] = 18;
          bases.d[l * 400 + c] = 6;
        }
        if (Math.abs(x) < 20 && y < -70 && y > -72) arbres.d[l * 400 + c] = 3;
      }
    }
    const f = calculerFaisceau([{ dur: sol, arbres, bases }], X0, Y0, 180, { pasAz: 1 });
    const d = new Float32Array(f.nk);
    const m = creerMasque(f.nk);
    horizonPourAltitude(f, 2, d, m);
    const j = indiceAzimut(f, 180);
    // Le houppier commence vu sous atan(4 / 14) et finit sous atan(16 / 10) ; la haie culmine sous atan(1 / 70).
    // (à une cellule près : la dernière rangée est atteinte à 13,5 m.)
    expect(Math.abs(m.houppier[j] - 4 / 14)).toBeLessThan(0.02);
    expect(Math.abs(m.sommet[j] - 16 / 10)).toBeLessThan(0.02);
    expect(Math.abs(m.bas[j] - 1 / 70)).toBeLessThan(0.002);
    expect(cacheParArbres(m, j, 0.01)).toBe(true); // derrière la haie
    expect(cacheParArbres(m, j, 0.15)).toBe(false); // sous les branches
    expect(cacheParArbres(m, j, 0.8)).toBe(true); // dans le houppier
    expect(cacheParArbres(m, j, 2)).toBe(false); // au-dessus
    // Vu d'un étage au-dessus de la base du houppier, plus de passage dessous.
    horizonPourAltitude(f, 8, d, m);
    expect(cacheParArbres(m, j, 0.05)).toBe(true);
    expect(m.houppier[j]).toBeLessThan(m.bas[j]);
    // Sans base connue, l'arbre est plein jusqu'au sol, comme avant.
    const plein = calculerFaisceau([{ dur: sol, arbres }], X0, Y0, 180, { pasAz: 1 });
    horizonPourAltitude(plein, 2, d, m);
    expect(cacheParArbres(m, j, 0.15)).toBe(true);
  });
});
